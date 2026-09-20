'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const m = require('./acilis-gostergesi');

// Gerçek paketten alınmış (a197871bbadc65819d58.897.js) küçültülmüş parça.
const GERCEK =
  'var j=function(e){var t=e.loadBook,n=U(),o=(0,u.oR)(),r=(0,a.Z)(o,1)[0],l=(0,i.useState)(!1),' +
  's=(0,a.Z)(l,2),m=s[0],d=s[1];return(0,i.useEffect)((function(){var e;if(null!=(null===(e=r.module)' +
  '||void 0===e?void 0:e.oneBook)){var n=r.module.covers[0],a=r.module.checkUpdates[r.module.oneBook];' +
  '(null==a?void 0:a.status)===c.JF.PENDING?(d(!0),O(a.url,n).finally((function(){d(!1),t(n)}))):' +
  '(null==a?void 0:a.status)===c.JF.NONE&&t(n)}}),[r.module.checkUpdates]),(0,i.useEffect)((function(){' +
  'return m||(window.t1=setTimeout((function(){t(r.module.covers[0])}),5e3)),function(){' +
  'return clearTimeout(window.t1)}}),[m]),i.createElement("div",{className:n.fullscreen},' +
  'i.createElement("p",null,m?"Kitap Güncelleniyor %".concat(g):"Kitap Açılıyor.."))};';

test('gerçek kalıpta hem güvence hem metin yamalanır', () => {
  const r = m.icerigiDuzelt(GERCEK);
  assert.strictEqual(r.uygulandi, true);
  assert.strictEqual(r.guvence, 1);
  assert.strictEqual(r.metin, 1);
  assert.match(r.icerik, /setTimeout\(\(function\(\)\{\/\*EMPP_ACILIS_GOSTERGE\*\/t\(r\.module\.covers\[0\]\)\}\),0\)/);
  assert.doesNotMatch(r.icerik, /"Kitap Açılıyor/);
});

test('5e3 GERÇEKTEN 0 olur — eski değer kalmaz', () => {
  const r = m.icerigiDuzelt(GERCEK);
  assert.doesNotMatch(r.icerik, /window\.t1=setTimeout\([^)]*\}\),5e3\)/);
});

test('"Kitap Güncelleniyor" dalı KORUNUR (tek bilgilendirici gösterge)', () => {
  const r = m.icerigiDuzelt(GERCEK);
  assert.match(r.icerik, /"Kitap Güncelleniyor %"\.concat\(g\):""/);
});

test('loadBook ve durum değişkeni adları korunur (başka değişken uydurulmaz)', () => {
  const ozel = GERCEK.replace(/t\(r\.module\.covers\[0\]\)/, 'YUKLE(DURUM.module.covers[0])')
    .replace('window.t1=setTimeout((function(){YUKLE', 'window.t1=setTimeout((function(){YUKLE');
  const r = m.icerigiDuzelt(ozel);
  assert.strictEqual(r.guvence, 1);
  assert.match(r.icerik, /YUKLE\(DURUM\.module\.covers\[0\]\)/);
});

test('gecikme dışarıdan verilebilir', () => {
  const r = m.icerigiDuzelt(GERCEK, { gecikmeMs: 250 });
  assert.match(r.icerik, /\}\),250\)/);
});

test('negatif/geçersiz gecikme varsayılana düşer', () => {
  for (const g of [-5, NaN, 'abc', null, undefined]) {
    const r = m.icerigiDuzelt(GERCEK, { gecikmeMs: g });
    assert.match(r.icerik, /\}\),0\)/, `gecikme=${g}`);
  }
});

test('gecikme 0 kabul edilir (falsy tuzağı)', () => {
  const r = m.icerigiDuzelt(GERCEK, { gecikmeMs: 0 });
  assert.match(r.icerik, /\}\),0\)/);
});

test('idempotent — ikinci geçişte dokunmaz', () => {
  const bir = m.icerigiDuzelt(GERCEK);
  const iki = m.icerigiDuzelt(bir.icerik);
  assert.strictEqual(iki.uygulandi, false);
  assert.strictEqual(iki.sebep, 'zaten-yamali');
  assert.strictEqual(iki.icerik, bir.icerik);
});

test('kalıp yoksa dosya AYNEN kalır', () => {
  const baska = 'var x=setTimeout(function(){oyna()},5e3);console.log("Kitap kapandı");';
  const r = m.icerigiDuzelt(baska);
  assert.strictEqual(r.uygulandi, false);
  assert.strictEqual(r.sebep, 'kalip-yok');
  assert.strictEqual(r.icerik, baska);
});

test('BENZEYEN ama ilgisiz 5e3 zamanlayıcısına DOKUNULMAZ', () => {
  const tuzak = 'setTimeout((function(){t(r.module.covers[0])}),5e3);' + GERCEK;
  const r = m.icerigiDuzelt(tuzak);
  assert.strictEqual(r.guvence, 1, 'yalnız window.t1 olan yamalanmalı');
  // İlk (window.t1 olmayan) çağrı hâlâ 5e3 olmalı.
  assert.match(r.icerik, /^setTimeout\(\(function\(\)\{t\(r\.module\.covers\[0\]\)\}\),5e3\)/);
});

test('BAŞKA yerdeki "Kitap Açılıyor.." metnine dokunulmaz (çapa: Güncelleniyor üçlüsü)', () => {
  const tuzak = 'var mesaj="Kitap Açılıyor..";' + GERCEK;
  const r = m.icerigiDuzelt(tuzak);
  assert.strictEqual(r.metin, 1);
  assert.match(r.icerik, /^var mesaj="Kitap Açılıyor\.\.";/);
});

test('yalnız metin varsa da yamalanır (güvence başka pakette olabilir)', () => {
  const yalniz = 'i.createElement("p",null,m?"Kitap Güncelleniyor %".concat(g):"Kitap Açılıyor..")';
  const r = m.icerigiDuzelt(yalniz);
  assert.strictEqual(r.uygulandi, true);
  assert.strictEqual(r.guvence, 0);
  assert.strictEqual(r.metin, 1);
});

test('ESKİ SÜRÜM (yüzdesiz, güvencesiz) metni de boşaltılır', () => {
  const eski = 'a.createElement("p",null,m?"Kitap Güncelleniyor":"Kitap Açılıyor..")';
  const r = m.icerigiDuzelt(eski);
  assert.strictEqual(r.uygulandi, true);
  assert.strictEqual(r.metin, 1);
  assert.strictEqual(r.guvence, 0, 'bu sürümde window.t1 güvencesi yok');
  assert.match(r.icerik, /m\?"Kitap Güncelleniyor":""/);
  assert.doesNotMatch(r.icerik, /"Kitap Açılıyor/);
});

test('ESKİ sürümde de "Güncelleniyor" dalı korunur', () => {
  const eski = 'm?"Kitap Güncelleniyor":"Kitap Açılıyor.."';
  assert.match(m.icerigiDuzelt(eski).icerik, /"Kitap Güncelleniyor"/);
});

test('çapasız "Kitap Açılıyor.." yine dokunulmaz (iki sürüm de çapa ister)', () => {
  const capasiz = 'var a="Kitap Açılıyor..";var b=x?"Baska":"Kitap Açılıyor..";';
  const r = m.icerigiDuzelt(capasiz);
  assert.strictEqual(r.uygulandi, false);
  assert.strictEqual(r.icerik, capasiz);
});

test('boş/None girdi çökertmez', () => {
  for (const g of [null, undefined, '']) {
    const r = m.icerigiDuzelt(g);
    assert.strictEqual(r.uygulandi, false);
    assert.strictEqual(r.icerik, '');
  }
});

test('kapı: varsayılan AÇIK, yalnız "0" kapatır', () => {
  assert.strictEqual(m.acikMi({}), true);
  assert.strictEqual(m.acikMi({ EMPP_ACILIS_GOSTERGE: '1' }), true);
  assert.strictEqual(m.acikMi({ EMPP_ACILIS_GOSTERGE: 'kapali' }), true);
  assert.strictEqual(m.acikMi({ EMPP_ACILIS_GOSTERGE: '0' }), false);
});

test('gecikme() ortamdan okunur', () => {
  assert.strictEqual(m.gecikme({}), 0);
  assert.strictEqual(m.gecikme({ EMPP_ACILIS_GECIKME_MS: '400' }), 400);
  assert.strictEqual(m.gecikme({ EMPP_ACILIS_GECIKME_MS: '-1' }), 0);
  assert.strictEqual(m.gecikme({ EMPP_ACILIS_GECIKME_MS: 'x' }), 0);
});

test('pakete uygulanır: kök + alt kitap, yalnız .js', async () => {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'k27-'));
  await fs.writeFile(path.join(kok, 'main.js'), GERCEK, 'utf8');
  await fs.ensureDir(path.join(kok, 'book2'));
  await fs.writeFile(path.join(kok, 'book2', 'app.js'), GERCEK, 'utf8');
  await fs.writeFile(path.join(kok, 'book2', 'app.js.map'), GERCEK, 'utf8');
  await fs.writeFile(path.join(kok, 'index.html'), GERCEK, 'utf8');
  await fs.writeFile(path.join(kok, 'bos.js'), 'var a=1;', 'utf8');

  const r = await m.paketeUygula(kok);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r.reduce((t, x) => t + x.dosya, 0), 2);

  assert.doesNotMatch(await fs.readFile(path.join(kok, 'main.js'), 'utf8'), /5e3/);
  assert.doesNotMatch(await fs.readFile(path.join(kok, 'book2', 'app.js'), 'utf8'), /5e3/);
  // .js olmayanlara dokunulmaz
  assert.match(await fs.readFile(path.join(kok, 'book2', 'app.js.map'), 'utf8'), /5e3/);
  assert.match(await fs.readFile(path.join(kok, 'index.html'), 'utf8'), /5e3/);
  assert.strictEqual(await fs.readFile(path.join(kok, 'bos.js'), 'utf8'), 'var a=1;');
  await fs.remove(kok);
});

test('paketeUygula: YALNIZ metin içeren paket de yamalanır (hızlı eleme "veya" olmalı)', async () => {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'k27c-'));
  // window.t1 YOK, yalnız metin var — eleme koşulu && olursa bu dosya atlanır.
  await fs.writeFile(path.join(kok, 'yalniz-metin.js'),
    'i.createElement("p",null,m?"Kitap Güncelleniyor %".concat(g):"Kitap Açılıyor..")', 'utf8');
  // Metin YOK, yalnız güvence var.
  await fs.writeFile(path.join(kok, 'yalniz-guvence.js'),
    'window.t1=setTimeout((function(){t(r.module.covers[0])}),5e3)', 'utf8');
  const r = await m.paketeUygula(kok);
  assert.strictEqual(r.reduce((t, x) => t + x.dosya, 0), 2);
  assert.doesNotMatch(await fs.readFile(path.join(kok, 'yalniz-metin.js'), 'utf8'), /"Kitap Açılıyor/);
  assert.doesNotMatch(await fs.readFile(path.join(kok, 'yalniz-guvence.js'), 'utf8'), /5e3/);
  await fs.remove(kok);
});

test('paketeUygula idempotent — ikinci koşuda 0 dosya', async () => {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'k27b-'));
  await fs.writeFile(path.join(kok, 'main.js'), GERCEK, 'utf8');
  await m.paketeUygula(kok);
  const ikinci = await m.paketeUygula(kok);
  assert.strictEqual(ikinci.length, 0);
  await fs.remove(kok);
});

test('yamalı çıktı SÖZDİZİMSEL olarak geçerli kalır', () => {
  const r = m.icerigiDuzelt(GERCEK);
  // new Function ile ayrıştırma: bozuk parantez/virgül anında yakalanır.
  assert.doesNotThrow(() => new Function(`var c={JF:{}},u={},a={},i={},U=function(){},O=function(){};${r.icerik}`));
});
