'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const m = require('./acilis-ilk-sayfa.js');

// Yayıncı paketindeki GERÇEK kalıp (4258fee233041faa248e.js @193508'den birebir).
const GERCEK = 'AppConfig.xml.isWeb||o.module.covers.map((function(e){'
  + 'o.module.checkUpdates[e.id]||wn(e).then((function(t){'
  + 's(l.module.SET_CHECK_UPDATE,{id:e.id,update:Boolean(t.Data),url:t.Data,'
  + 'currentVersion:e.version,newVersion:t.Vs,'
  + 'status:Boolean(t.Data)?an.JF.PENDING:an.JF.NONE})}))}))';

function sozdizimiGecerliMi(kod) {
  const yol = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ilksayfa-')), 'a.js');
  fs.writeFileSync(yol, kod);
  try { execFileSync(process.execPath, ['--check', yol], { stdio: 'pipe' }); return true; }
  catch { return false; }
}

/**
 * Yamalı kodu GERÇEKTEN KOŞTURUR. Mock yalnız sorgunun kendisidir; zincirin
 * geri kalanı (Promise.race / catch / then / dispatch) yamanın ürettiği koddur.
 * @param {'red'|'asili'|'guncelleme-var'|'guncelleme-yok'} davranis
 */
function kosturVeBekle(kod, davranis, { butceMs = 60 } = {}) {
  const gonderilen = [];
  const sandbox = {
    AppConfig: { xml: { isWeb: false } },
    o: { module: { covers: [{ id: 'k1', version: '1.0.0' }], checkUpdates: {} } },
    l: { module: { SET_CHECK_UPDATE: 'SET_CHECK_UPDATE' } },
    an: { JF: { PENDING: 'PENDING', NONE: 'NONE' } },
    s: (tur, yuk) => gonderilen.push({ tur, yuk }),
    wn: () => {
      if (davranis === 'red') return Promise.reject(new Error('ENOTFOUND'));
      if (davranis === 'asili') return new Promise(() => {});
      if (davranis === 'guncelleme-var') return Promise.resolve({ Data: 'http://x/y.zip', Vs: '2.0.0' });
      return Promise.resolve({ Data: null, Vs: '1.0.0' });
    },
    setTimeout, clearTimeout, Promise, Boolean,
  };
  vm.runInNewContext(kod, sandbox);
  return new Promise((coz) => setTimeout(() => coz(gonderilen), butceMs + 120));
}

const yamali = (secenek) => m.icerigiDuzelt(GERCEK, { butceMs: 60, ...secenek }).icerik;

test('kapı varsayılan AÇIK, yalnız 0 kapatır', () => {
  assert.strictEqual(m.acikMi({}), true);
  assert.strictEqual(m.acikMi({ EMPP_ILK_SAYFA: '0' }), false);
});

test('SAHA KALIBI yakalanır ve geçerli JS üretir', () => {
  const r = m.icerigiDuzelt(GERCEK);
  assert.strictEqual(r.uygulandi, true);
  assert.strictEqual(r.yama, 1);
  assert.strictEqual(sozdizimiGecerliMi(`var f=function(){${r.icerik}};`), true);
});

// --- DAVRANIŞ: yamalı kod gerçekten koşturulur ---

test('REDDEDİLEN sorgu → kitap BEKLETİLMEZ, karar NONE olarak gönderilir', async () => {
  const g = await kosturVeBekle(yamali(), 'red');
  assert.strictEqual(g.length, 1, 'yamasızken hiç gönderim olmaz, 5 sn güvencesi beklenirdi');
  assert.strictEqual(g[0].yuk.status, 'NONE');
  assert.strictEqual(g[0].yuk.update, false);
});

test('ASILI sorgu → süre bütçesi dolunca karar gelir (sonsuz bekleme yok)', async () => {
  const basla = Date.now();
  const g = await kosturVeBekle(yamali(), 'asili');
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].yuk.status, 'NONE');
  assert.ok(Date.now() - basla >= 60, 'bütçeden önce karar vermemeli');
});

test('YAMASIZ kod aynı koşulda HİÇ karar göndermez — arızanın kanıtı', () => {
  // AYRI SÜREÇTE koşar: yamasız zincirde `.catch` olmadığı için reddedilen sorgu
  // YAKALANMAMIŞ promise reddi üretir ve node süreci düşürür. (Bu testin ilk hâli
  // tam da o reddi yiyip çöktü; node:test kendi kancasıyla yakaladığı için kontrol
  // artık dışarıda koşuyor.) Hiçbir karar gönderilmez — kitabı açan tek şey 5 sn.
  const betik = `
    const vm = require('node:vm');
    const g = [];
    vm.runInNewContext(${JSON.stringify(GERCEK)}, {
      AppConfig: { xml: { isWeb: false } },
      o: { module: { covers: [{ id: 'k1', version: '1.0.0' }], checkUpdates: {} } },
      l: { module: { SET_CHECK_UPDATE: 'SET_CHECK_UPDATE' } },
      an: { JF: { PENDING: 'PENDING', NONE: 'NONE' } },
      s: (t, y) => g.push(y),
      wn: () => Promise.reject(new Error('ENOTFOUND')),
      setTimeout, Promise, Boolean,
    });
    setTimeout(() => { console.log('GONDERIM=' + g.length); }, 200);
  `;
  const yol = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ilksayfa-kontrol-')), 'k.js');
  fs.writeFileSync(yol, betik);
  let cikti = '';
  let dustu = false;
  try {
    cikti = execFileSync(process.execPath, [yol], { stdio: 'pipe', encoding: 'utf8' });
  } catch (e) {
    dustu = true;
    cikti = String(e.stdout || '') + String(e.stderr || '');
  }
  assert.strictEqual(dustu, true, 'yamasız zincir yakalanmamış reddi süreci düşürmeli');
  assert.match(cikti, /ERR_UNHANDLED_REJECTION|ENOTFOUND/);
  assert.strictEqual(/GONDERIM=[1-9]/.test(cikti), false, 'hiçbir karar gönderilmemeli');
});

test('YAMALI kod reddi yutar — sahipsiz promise reddi bırakmaz', async () => {
  const yutulan = [];
  const dinleyici = (e) => yutulan.push(e);
  process.on('unhandledRejection', dinleyici);
  try {
    await kosturVeBekle(yamali(), 'red');
  } finally {
    process.off('unhandledRejection', dinleyici);
  }
  assert.deepStrictEqual(yutulan, []);
});

test('SAĞLIKLI sorgu davranışı DEĞİŞMEZ — güncelleme hâlâ PENDING', async () => {
  const g = await kosturVeBekle(yamali(), 'guncelleme-var');
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].yuk.status, 'PENDING');
  assert.strictEqual(g[0].yuk.url, 'http://x/y.zip');
  assert.strictEqual(g[0].yuk.newVersion, '2.0.0');
});

test('güncellemesi olmayan sağlıklı sorgu NONE döndürmeye devam eder', async () => {
  const g = await kosturVeBekle(yamali(), 'guncelleme-yok');
  assert.strictEqual(g[0].yuk.status, 'NONE');
});

test('geç dönen sorgu İKİNCİ KEZ karar göndermez', async () => {
  const gec = GERCEK.replace('wn(e)', 'wnGec(e)');
  const kod = m.icerigiDuzelt(gec, { butceMs: 40 }).icerik;
  const gonderilen = [];
  const sandbox = {
    AppConfig: { xml: { isWeb: false } },
    o: { module: { covers: [{ id: 'k1', version: '1.0.0' }], checkUpdates: {} } },
    l: { module: { SET_CHECK_UPDATE: 'SET_CHECK_UPDATE' } },
    an: { JF: { PENDING: 'PENDING', NONE: 'NONE' } },
    s: (tur, yuk) => gonderilen.push({ tur, yuk }),
    wnGec: () => new Promise((r) => setTimeout(() => r({ Data: 'geç', Vs: '9' }), 200)),
    setTimeout, clearTimeout, Promise, Boolean,
  };
  vm.runInNewContext(kod, sandbox);
  await new Promise((c) => setTimeout(c, 400));
  assert.strictEqual(gonderilen.length, 1);
  assert.strictEqual(gonderilen[0].yuk.status, 'NONE');
});

// --- Kalıp seçiciliği ---

test('SET_CHECK_UPDATE içermeyen benzer zincir YAMALANMAZ', () => {
  const yanlis = 'a.checkUpdates[e.id]||wn(e).then((function(t){b(c.module.BASKA_EYLEM,{id:e.id})}))';
  const r = m.icerigiDuzelt(yanlis);
  assert.strictEqual(r.uygulandi, false);
  assert.strictEqual(r.sebep, 'kalip-yok');
  assert.strictEqual(r.icerik, yanlis);
});

test('AYNI dosyadaki UZAK benzer zincir yamalanmaz (çapa dosya değil, çağrı başına)', () => {
  // Dosya SET_CHECK_UPDATE içeriyor (gerçek sorgu var), ama ikinci zincir bambaşka
  // bir eylem gönderiyor. Çapa denetimi çağrı başına olmazsa bu da yamalanır.
  const uzak = 'z.checkUpdates[u.id]||qq(u).then((function(t){'
    + 'b(c.module.BASKA_EYLEM,{id:u.id})}))';
  const dolgu = 'x'.repeat(m.CAPA_PENCERESI ? 0 : 0) + ';/*'.padEnd(600, 'y') + '*/;';
  const r = m.icerigiDuzelt(GERCEK + dolgu + uzak);
  assert.strictEqual(r.yama, 1, 'yalnız gerçek sorgu yamalanmalı');
  assert.ok(r.icerik.includes(uzak), 'uzak zincir olduğu gibi kalmalı');
});

test('çağrı argümanı kapak değişkeni değilse yamalanmaz', () => {
  const baska = GERCEK.replace('wn(e)', 'wn(z)');
  assert.strictEqual(m.icerigiDuzelt(baska).uygulandi, false);
});

test('aynı dosyadaki BİRDEN ÇOK çağrı yerinin hepsi yamalanır', () => {
  const iki = GERCEK + ';' + GERCEK.replace(/\be\b/g, 'q').replace('wn(q)', 'wn(q)');
  const r = m.icerigiDuzelt(iki);
  assert.strictEqual(r.yama, 2);
});

test('iki kez uygulanmaz', () => {
  const bir = m.icerigiDuzelt(GERCEK);
  const iki = m.icerigiDuzelt(bir.icerik);
  assert.strictEqual(iki.uygulandi, false);
  assert.strictEqual(iki.sebep, 'zaten-yamali');
  assert.strictEqual(iki.icerik, bir.icerik);
});

test('bütçe ayarlanabilir; geçersiz değer varsayılana döner', () => {
  assert.match(m.icerigiDuzelt(GERCEK, { butceMs: 1234 }).icerik, /\},1234\)/);
  assert.match(m.icerigiDuzelt(GERCEK, { butceMs: 0 }).icerik,
    new RegExp(`\\},${m.VARSAYILAN_BUTCE_MS}\\)`));
  assert.match(m.icerigiDuzelt(GERCEK, { butceMs: -5 }).icerik,
    new RegExp(`\\},${m.VARSAYILAN_BUTCE_MS}\\)`));
});

test('null/undefined girdi çökmez', () => {
  assert.doesNotThrow(() => m.icerigiDuzelt(null));
  assert.doesNotThrow(() => m.icerigiDuzelt(undefined));
});

// --- paketeUygula: gerçek dosya sistemi ---

function paketKur() {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'ilksayfa-paket-'));
  fs.writeFileSync(path.join(kok, 'alakasiz.js'), 'console.log(1)');
  fs.mkdirSync(path.join(kok, 'book1'));
  fs.writeFileSync(path.join(kok, 'book1', 'main.js'), `var f=function(){${GERCEK}};`);
  fs.writeFileSync(path.join(kok, 'book1', 'vendor.js'), 'var a=1;');
  fs.writeFileSync(path.join(kok, 'book1', 'stil.css'), '.a{}');
  fs.mkdirSync(path.join(kok, 'book2'));
  fs.writeFileSync(path.join(kok, 'book2', 'main.js'), `var f=function(){${GERCEK}};`);
  return kok;
}

test('alt kitapların hepsi yamalanır, alakasız dosyalara dokunulmaz', async () => {
  const kok = paketKur();
  const alakasiz = path.join(kok, 'book1', 'vendor.js');
  const once = fs.statSync(alakasiz).mtimeMs;
  const r = await m.paketeUygula(kok);
  assert.strictEqual(r.length, 2, 'book1 ve book2');
  assert.deepStrictEqual(r.map((x) => x.cagri), [1, 1]);
  for (const kitap of ['book1', 'book2']) {
    const yeni = fs.readFileSync(path.join(kok, kitap, 'main.js'), 'utf8');
    assert.match(yeni, new RegExp(m.ISARET));
    assert.strictEqual(sozdizimiGecerliMi(yeni), true);
  }
  assert.strictEqual(fs.statSync(alakasiz).mtimeMs, once, 'kalıpsız dosya yeniden yazılmamalı');
  assert.strictEqual(fs.readFileSync(alakasiz, 'utf8'), 'var a=1;');
});

test('.js OLMAYAN dosya kalıbı içerse bile yamalanmaz', async () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'ilksayfa-suzgec-'));
  const harita = path.join(kok, 'main.js.map');
  const sayfa = path.join(kok, 'index.html');
  fs.writeFileSync(harita, `{"sourcesContent":["${GERCEK.replace(/"/g, '\\"')}"]}`);
  fs.writeFileSync(sayfa, `<script>${GERCEK}</script>`);
  const haritaOnce = fs.readFileSync(harita, 'utf8');
  const sayfaOnce = fs.readFileSync(sayfa, 'utf8');
  assert.deepStrictEqual(await m.paketeUygula(kok), []);
  assert.strictEqual(fs.readFileSync(harita, 'utf8'), haritaOnce);
  assert.strictEqual(fs.readFileSync(sayfa, 'utf8'), sayfaOnce);
});

test('kök dizindeki paket de yamalanır (tek kitap yerleşimi)', async () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'ilksayfa-tek-'));
  fs.writeFileSync(path.join(kok, 'main.js'), `var f=function(){${GERCEK}};`);
  const r = await m.paketeUygula(kok);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].dizin, '.');
  assert.match(fs.readFileSync(path.join(kok, 'main.js'), 'utf8'), new RegExp(m.ISARET));
});

test('ikinci koşu dosyaları DEĞİŞTİRMEZ', async () => {
  const kok = paketKur();
  await m.paketeUygula(kok);
  const ilk = fs.readFileSync(path.join(kok, 'book1', 'main.js'), 'utf8');
  assert.deepStrictEqual(await m.paketeUygula(kok), []);
  assert.strictEqual(fs.readFileSync(path.join(kok, 'book1', 'main.js'), 'utf8'), ilk);
});

test('kalıpsız paket sessizce geçilir', async () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'ilksayfa-yok-'));
  fs.writeFileSync(path.join(kok, 'a.js'), 'var a=1;');
  assert.deepStrictEqual(await m.paketeUygula(kok), []);
});
