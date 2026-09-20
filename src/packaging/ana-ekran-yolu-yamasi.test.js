'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const M = require('./ana-ekran-yolu-yamasi');

const HATALI = 'd=function(){try{return s.join(s.dirname(window.location.href),"../")}catch(e){}return"/"}';

test('hatalı kalıp düzeltilir ve işaret bırakılır', () => {
  const r = M.icerigiDuzelt(HATALI);
  assert.equal(r.adet, 1);
  assert.equal(r.sebep, 'duzeltildi');
  assert.match(r.icerik, /EMPP_ANA_EKRAN_YOLU/);
  assert.doesNotMatch(r.icerik, /\.join\(\w+\.dirname\(window\.location\.href\)/);
});

test('GERİLEME: yamalı ifade Windows adresinde GEÇERLİ url üretir', () => {
  // Arızanın ta kendisi: path.win32 ile hesap ".\\file:\\C:\\…" veriyordu.
  const href = 'file:///C:/Users/x/Programs/sm4/resources/app.asar/book1/index.html';
  const bozuk = path.win32.join(path.win32.dirname(href), '../') + '/index.html';
  assert.match(bozuk, /^\.\\file:\\/, 'bozuk hâlin imzası korunmalı (arıza kanıtı)');

  const window = { location: { href } };
  const duzgun = new URL('..', window.location.href).href.replace(/\/$/, '') + '/index.html';
  assert.equal(duzgun, 'file:///C:/Users/x/Programs/sm4/resources/app.asar/index.html');
  assert.doesNotThrow(() => new URL(duzgun));
});

test('Linux adresinde de doğru üretir', () => {
  const window = { location: { href: 'file:///opt/sm4/app.asar/book1/index.html' } };
  const d = new URL('..', window.location.href).href.replace(/\/$/, '') + '/index.html';
  assert.equal(d, 'file:///opt/sm4/app.asar/index.html');
});

test('değişken adı farklı olsa da yakalar (geri referans)', () => {
  const r = M.icerigiDuzelt('return q.join(q.dirname(window.location.href),"../")');
  assert.equal(r.adet, 1);
});

test('GÜVENLİK: join ve dirname FARKLI değişkense DOKUNMAZ', () => {
  const r = M.icerigiDuzelt('return a.join(b.dirname(window.location.href),"../")');
  assert.equal(r.adet, 0);
  assert.equal(r.sebep, 'kalip-yok');
});

test('GÜVENLİK: benzer ama başka kalıplara dokunmaz', () => {
  for (const s of [
    's.join(s.dirname(someOther.href),"../")',
    's.join(s.dirname(window.location.href),"./")',
    's.resolve(s.dirname(window.location.href),"../")',
  ]) assert.equal(M.icerigiDuzelt(s).adet, 0, s);
});

test('ikinci kez çalıştırmak bozmaz (idempotent)', () => {
  const bir = M.icerigiDuzelt(HATALI);
  const iki = M.icerigiDuzelt(bir.icerik);
  assert.equal(iki.adet, 0);
  assert.equal(iki.sebep, 'zaten-yamali');
  assert.equal(iki.icerik, bir.icerik);
});

test('aynı dosyada birden çok geçiş sayılır', () => {
  const r = M.icerigiDuzelt(HATALI + ';' + HATALI.replace(/\bs\./g, 'z.'));
  assert.equal(r.adet, 2);
});

test('boş/null girdi çökmez', () => {
  assert.equal(M.icerigiDuzelt(null).adet, 0);
  assert.equal(M.icerigiDuzelt('').adet, 0);
});

test('diskte: kök + bookN gezilir, sadece .js dokunulur', async () => {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'empp-k20-'));
  try {
    await fs.ensureDir(path.join(d, 'book1'));
    await fs.ensureDir(path.join(d, 'assets2'));
    await fs.writeFile(path.join(d, 'book1', 'motor.js'), HATALI);
    await fs.writeFile(path.join(d, 'kabuk.js'), HATALI);
    await fs.writeFile(path.join(d, 'book1', 'veri.json'), HATALI);      // .js değil
    await fs.writeFile(path.join(d, 'assets2', 'scripts.js'), HATALI);   // bookN değil, kök değil
    const r = await M.paketiDuzelt(d);
    assert.equal(r.toplamDosya, 2);
    assert.equal(r.toplamAdet, 2);
    assert.match(await fs.readFile(path.join(d, 'book1', 'motor.js'), 'utf8'), /EMPP_ANA_EKRAN_YOLU/);
    assert.match(await fs.readFile(path.join(d, 'kabuk.js'), 'utf8'), /EMPP_ANA_EKRAN_YOLU/);
    assert.doesNotMatch(await fs.readFile(path.join(d, 'book1', 'veri.json'), 'utf8'), /EMPP_ANA_EKRAN_YOLU/);
    assert.doesNotMatch(await fs.readFile(path.join(d, 'assets2', 'scripts.js'), 'utf8'), /EMPP_ANA_EKRAN_YOLU/);
  } finally { await fs.remove(d); }
});

test('sentinel: packagingService yamayı ÇAĞIRIR', () => {
  const SRC = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  assert.match(SRC, /require\('\.\/ana-ekran-yolu-yamasi'\)/);
  assert.match(SRC, /anaEkranYolu\.paketiDuzelt\(workingPath/);
});
