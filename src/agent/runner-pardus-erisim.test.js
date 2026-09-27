'use strict';

/**
 * PARDUS KABUL ERİŞİM KAPISI (2026-09-27) — ProBook'a (kabul betiğinin ssh ile bağlanacağı
 * host) erişilemiyorken Mac `pardus` yeteneğini heartbeat'ten düşürür. Windows imza yuvası
 * kapısıyla (`imzaYuvasiDurumu`) BİREBİR aynı sınıf: 60 sn önbellek, arka planda ölçülür,
 * heartbeat'i bekletmez. Nedeni: `tools/pardus/probook-kabul.sh` ProBook'a ssh atamayınca
 * "RED: ProBook'a baglanilamadi" ile düşüyor ve iş 1,5-10 dk boşa derlendikten sonra 30 dk
 * kirayla aynı döngüye giriyordu (27.09, ProBook 11:10Z'den beri kapalı, iş 60014).
 *
 * Üç katman test edilir: (1) saf karar fonksiyonu `pardusKabulErisimUygula` — tüm dallar +
 * mutasyonsuzluk, (2) runner entegrasyonu — `guncelYetenekler()` gerçek karara göre `pardus`u
 * düşürür/tutar, (3) gerçek TCP prob `probookErisimDurumu` — dinleyen/kapalı porta karşı.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const { pardusKabulErisimUygula } = require('./runner-helpers');
const runner = require('./runner.js');

const SRC = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// (1) Saf karar fonksiyonu — tüm dallar + mutasyonsuzluk
// ---------------------------------------------------------------------------

test('pardusKabulErisimUygula: caps\'te pardus yoksa aynen döner', () => {
  const caps = ['android', 'macos'];
  const r = pardusKabulErisimUygula(caps, { kabulAcik: true, kapiAcik: true, host: 'x', erisilir: false });
  assert.equal(r, caps, 'aynı referans dönmeli (dokunulmamış)');
});

test('pardusKabulErisimUygula: kabulAcik false → aynen döner (kabul yoksa ProBook gerekmez)', () => {
  const caps = ['android', 'pardus'];
  const r = pardusKabulErisimUygula(caps, { kabulAcik: false, kapiAcik: true, host: 'etapadmin@x', erisilir: false });
  assert.deepEqual(r, ['android', 'pardus']);
});

test('pardusKabulErisimUygula: kapiAcik false → acil kapatma, aynen döner', () => {
  const caps = ['android', 'pardus'];
  const r = pardusKabulErisimUygula(caps, { kabulAcik: true, kapiAcik: false, host: 'etapadmin@x', erisilir: false });
  assert.deepEqual(r, ['android', 'pardus']);
});

test('pardusKabulErisimUygula: host==="yerel" → kabul ProBook\'un kendisinde koşuyor, aynen döner', () => {
  const caps = ['android', 'pardus'];
  const r = pardusKabulErisimUygula(caps, { kabulAcik: true, kapiAcik: true, host: 'yerel', erisilir: false });
  assert.deepEqual(r, ['android', 'pardus']);
});

test('pardusKabulErisimUygula: erisilir===false → pardus DÜŞER, girdi mutasyona uğramaz', () => {
  const caps = ['android', 'pardus', 'macos'];
  const r = pardusKabulErisimUygula(caps, { kabulAcik: true, kapiAcik: true, host: 'etapadmin@100.73.161.76', erisilir: false });
  assert.deepEqual(r, ['android', 'macos']);
  assert.deepEqual(caps, ['android', 'pardus', 'macos'], 'girdi dizisi değişmemeli');
  assert.notEqual(r, caps, 'yeni dizi dönmeli');
});

test('pardusKabulErisimUygula: erisilir true/undefined/null → aynen döner (henüz ölçülmedi dahil)', () => {
  const caps = ['android', 'pardus'];
  for (const erisilir of [true, undefined, null]) {
    const r = pardusKabulErisimUygula(caps, { kabulAcik: true, kapiAcik: true, host: 'etapadmin@x', erisilir });
    assert.deepEqual(r, ['android', 'pardus'], String(erisilir));
  }
});

test('pardusKabulErisimUygula: d parametresi hiç verilmezse çökmez, aynen döner', () => {
  const caps = ['pardus'];
  assert.deepEqual(pardusKabulErisimUygula(caps, undefined), ['pardus']);
});

// ---------------------------------------------------------------------------
// (2) Runner entegrasyonu — guncelYetenekler() gerçek karara göre pardus'u düşürür/tutar
// ---------------------------------------------------------------------------

test('guncelYetenekler: ProBook erişilemez → pardus düşer; erişilir → geri gelir; acil kapatmada kalır', () => {
  const eskiCaps = runner.CONFIG.caps;
  const eskiPardusKabul = runner.CONFIG.pardusKabul;
  const eskiEnvKabul = process.env.EMPP_PARDUS_KABUL;
  const eskiEnvErisim = process.env.EMPP_PARDUS_KABUL_ERISIM;
  runner.CONFIG.caps = ['android', 'pardus'];
  runner.CONFIG.pardusKabul = true; // EMPP_PARDUS_KABUL='1' simülasyonu (guncelYetenekler CONFIG.pardusKabul okur)
  delete process.env.EMPP_PARDUS_KABUL_ERISIM;
  try {
    runner._probookErisimAyarla({ t: Date.now(), erisilir: false, suruyor: false });
    assert.deepEqual(runner.guncelYetenekler(), ['android'], 'erişilemez → pardus düşer');

    runner._probookErisimAyarla({ t: Date.now(), erisilir: true, suruyor: false });
    assert.deepEqual(runner.guncelYetenekler(), ['android', 'pardus'], 'erişilir → pardus geri gelir');

    runner._probookErisimAyarla({ t: Date.now(), erisilir: false, suruyor: false });
    process.env.EMPP_PARDUS_KABUL_ERISIM = '0';
    assert.deepEqual(runner.guncelYetenekler(), ['android', 'pardus'], 'acil kapatmada (=0) erişilemezlik yok sayılır');
  } finally {
    runner.CONFIG.caps = eskiCaps;
    runner.CONFIG.pardusKabul = eskiPardusKabul;
    if (eskiEnvKabul === undefined) delete process.env.EMPP_PARDUS_KABUL; else process.env.EMPP_PARDUS_KABUL = eskiEnvKabul;
    if (eskiEnvErisim === undefined) delete process.env.EMPP_PARDUS_KABUL_ERISIM; else process.env.EMPP_PARDUS_KABUL_ERISIM = eskiEnvErisim;
    runner._probookErisimAyarla({ t: 0, erisilir: undefined, suruyor: false });
  }
});

test('guncelYetenekler: kabul kapalıyken (pardusKabul=false) erişilemezlik pardus\'u düşürmez', () => {
  const eskiCaps = runner.CONFIG.caps;
  const eskiPardusKabul = runner.CONFIG.pardusKabul;
  runner.CONFIG.caps = ['android', 'pardus'];
  runner.CONFIG.pardusKabul = false;
  try {
    runner._probookErisimAyarla({ t: Date.now(), erisilir: false, suruyor: false });
    assert.deepEqual(runner.guncelYetenekler(), ['android', 'pardus']);
  } finally {
    runner.CONFIG.caps = eskiCaps;
    runner.CONFIG.pardusKabul = eskiPardusKabul;
    runner._probookErisimAyarla({ t: 0, erisilir: undefined, suruyor: false });
  }
});

test('guncelYetenekler: PROBOOK_HOST=yerel iken (kabul ProBook\'un kendisinde) prob sonucu pardus\'u düşürmez', () => {
  const eskiCaps = runner.CONFIG.caps;
  const eskiPardusKabul = runner.CONFIG.pardusKabul;
  const eskiHost = process.env.PROBOOK_HOST;
  runner.CONFIG.caps = ['android', 'pardus'];
  runner.CONFIG.pardusKabul = true;
  process.env.PROBOOK_HOST = 'yerel';
  try {
    runner._probookErisimAyarla({ t: Date.now(), erisilir: false, suruyor: false });
    assert.deepEqual(runner.guncelYetenekler(), ['android', 'pardus']);
  } finally {
    runner.CONFIG.caps = eskiCaps;
    runner.CONFIG.pardusKabul = eskiPardusKabul;
    if (eskiHost === undefined) delete process.env.PROBOOK_HOST; else process.env.PROBOOK_HOST = eskiHost;
    runner._probookErisimAyarla({ t: 0, erisilir: undefined, suruyor: false });
  }
});

test('probookErisimIlkOlcum: açılışta ilk ölçümü bekler — kapalı portta sınır içinde false döner', async () => {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  await new Promise((r) => srv.close(r)); // port artık kapalı
  runner._probookErisimAyarla({ t: 0, erisilir: undefined, suruyor: false });
  try {
    const bas = Date.now();
    const v = await runner.probookErisimIlkOlcum('etapadmin@127.0.0.1', { port, sinirMs: 6000 });
    assert.equal(v, false);
    assert.ok(Date.now() - bas < 6000, 'sınırı aşmadan döner');
  } finally {
    runner._probookErisimAyarla({ t: 0, erisilir: undefined, suruyor: false });
  }
});

test('kaynak sentinel: main() ilk heartbeat\'ten ÖNCE pardus erişim ölçümünü bekler', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
  const bas = kaynak.indexOf('async function main()');
  const govde = kaynak.slice(bas, kaynak.indexOf('await heartbeat(auth);', bas));
  assert.match(govde, /await probookErisimIlkOlcum\(/);
});

// ---------------------------------------------------------------------------
// (3) Gerçek TCP prob — dinleyen porta erişilir=true, kapalı porta false
// ---------------------------------------------------------------------------

async function olcumBekle(host, port) {
  runner._probookErisimAyarla({ t: 0, erisilir: undefined, suruyor: false });
  let v = runner.probookErisimDurumu(host, port);
  for (let i = 0; i < 100 && v === undefined; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await bekle(20);
    v = runner.probookErisimDurumu(host, port);
  }
  return v;
}

test('probookErisimDurumu: gerçek TCP ile dinleyen porta erişilir=true', async () => {
  const sunucu = net.createServer(() => {});
  await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
  const port = sunucu.address().port;
  try {
    // "kullanici@host" biçimini de doğru ayrıştırır (ssh hedefiyle aynı gösterim).
    const v = await olcumBekle('etapadmin@127.0.0.1', port);
    assert.equal(v, true);
  } finally {
    await new Promise((r) => sunucu.close(r));
    runner._probookErisimAyarla({ t: 0, erisilir: undefined, suruyor: false });
  }
});

test('probookErisimDurumu: gerçek TCP ile kapalı/erişilemeyen porta erisilir=false', async () => {
  // Port 1: ayrıcalıklı, bu makinede dinlenmiyor → ECONNREFUSED beklenir.
  const v = await olcumBekle('127.0.0.1', 1);
  assert.equal(v, false);
  runner._probookErisimAyarla({ t: 0, erisilir: undefined, suruyor: false });
});

test('probookErisimDurumu: 60 sn önbellek — aynı pencerede ikinci çağrı yeni prob başlatmaz', async () => {
  const sunucu = net.createServer(() => {});
  await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
  const port = sunucu.address().port;
  try {
    await olcumBekle('127.0.0.1', port);
    // Sunucuyu kapat — eğer ikinci çağrı yeniden prob başlatsaydı sonuç false'a dönerdi.
    await new Promise((r) => sunucu.close(r));
    const v2 = runner.probookErisimDurumu('127.0.0.1', port);
    assert.equal(v2, true, 'önbellek içindeyken eski (doğru) değer korunmalı');
  } finally {
    runner._probookErisimAyarla({ t: 0, erisilir: undefined, suruyor: false });
  }
});

// ---------------------------------------------------------------------------
// Kaynak sentinel — kapının koda gömülü olduğunu ve çocuk süreç KULLANMADIĞINI doğrular
// ---------------------------------------------------------------------------

test('kaynak sentinel: guncelYetenekler gövdesi pardusKabulErisimUygula çağırıyor', () => {
  const fn = SRC.slice(SRC.indexOf('function guncelYetenekler()'), SRC.indexOf('async function fetchNextJob'));
  assert.match(fn, /caps = pardusKabulErisimUygula\(caps, \{/);
  assert.match(fn, /kabulAcik: CONFIG\.pardusKabul/);
  assert.match(fn, /kapiAcik: process\.env\.EMPP_PARDUS_KABUL_ERISIM !== '0'/);
});

test('kaynak sentinel: probookErisimDurumu net.connect + 5000ms zaman aşımı kullanır, çocuk süreç YOK', () => {
  const fn = SRC.slice(SRC.indexOf('function probookErisimDurumu('), SRC.indexOf('let _sonYetenek'));
  assert.match(fn, /net\.connect\(\{ host: gercekHost, port, timeout: 5000 \}\)/);
  assert.doesNotMatch(fn, /spawn\(|execFile|exec\(|require\('child_process'\)/, 'ssh/nc gibi çocuk süreç kullanılmamalı');
});

test('kaynak sentinel: hata/zaman aşımı yolunda erisilir=true YAZILMAZ', () => {
  const fn = SRC.slice(SRC.indexOf('function probookErisimDurumu('), SRC.indexOf('let _sonYetenek'));
  assert.match(fn, /soket\.once\('timeout', \(\) => bitir\(false\)\)/);
  assert.match(fn, /soket\.once\('error', \(\) => bitir\(false\)\)/);
  assert.match(fn, /soket\.once\('connect', \(\) => bitir\(true\)\)/);
  // "bitir(true)" yalnız connect dalında geçer — bir kez.
  assert.equal((fn.match(/bitir\(true\)/g) || []).length, 1);
});
