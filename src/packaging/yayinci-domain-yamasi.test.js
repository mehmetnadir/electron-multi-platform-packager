'use strict';
// K16 (2026-09-10, Nadir talebi) — sorucoz.tv -> yayıncı domaini URL yeniden
// yazımını GERÇEKTEN dosya sistemiyle doğrular.
//
// Kaynak: ~/01dev/elecron-paket/src/packaging/cevrimdisi-yama.js (bayat kopya) —
// yalnız (1) URL yeniden yazma parçası taşındı. (2) version.txt sabitleme ve
// (3) fetch fail-open shim'i BİLİNÇLİ olarak TAŞINMADI (Nadir politikası, 2026-09-10).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsExtra = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const {
  applyPublisherDomainPatch,
  derivePublisherHost,
  rewriteHostInText,
  SORUCOZ_RE
} = require('./yayinci-domain-yamasi');

function tempBuildDir() {
  return fsExtra.mkdtempSync(path.join(os.tmpdir(), 'yayinci-domain-yamasi-test-'));
}

// Test bitince geçici dizini Çöp'e taşır (rm YOK — silme yasağı).
function cleanup(dir) {
  fsExtra.moveSync(dir, path.join(os.tmpdir(), `_cop-${path.basename(dir)}`), { overwrite: true });
}

// --- derivePublisherHost ---

test('derivePublisherHost: *.yayincilik.net kalıbından türetir', () => {
  const cfg = `const AppConfig = { testSolutionVideo: { apiTemplate: 'https://flashyelt.yayincilik.net/api/{id}' } };`;
  const host = derivePublisherHost([cfg]);
  assert.strictEqual(host, 'flashyelt.yayincilik.net');
});

test('derivePublisherHost: apiTemplate yoksa düz *.yayincilik.net URL kalıbından türetir', () => {
  const cfg = `updateEndpoint: 'https://tekexe.yayincilik.net/Update/check'`;
  const host = derivePublisherHost([cfg]);
  assert.strictEqual(host, 'tekexe.yayincilik.net');
});

test('derivePublisherHost: sorucoz.tv ASLA yayıncı host olarak seçilmez', () => {
  const cfg = `testSolutionVideo: { apiTemplate: 'https://www.sorucoz.tv/api/{id}' }`;
  const host = derivePublisherHost([cfg]);
  assert.strictEqual(host, null, 'sorucoz.tv apiTemplate host olarak DÖNMEMELİ');
});

test('derivePublisherHost: config\'te hiçbir yayıncı domain yoksa null döner (UYDURMAZ)', () => {
  const cfg = `const AppConfig = { appName: 'Test', initialLanguage: 'tr' };`;
  const host = derivePublisherHost([cfg]);
  assert.strictEqual(host, null);
});

test('derivePublisherHost: options.publisherHost verilirse doğrudan onu kullanır (override)', () => {
  const host = derivePublisherHost([''], { publisherHost: ' mec.yayincilik.net ' });
  assert.strictEqual(host, 'mec.yayincilik.net', 'trim edilmiş olmalı');
});

// --- rewriteHostInText ---

test('rewriteHostInText: www\'li ve www\'siz sorucoz.tv çoklu occurrence sayılır', () => {
  const text = `a: 'https://www.sorucoz.tv/x', b: 'http://sorucoz.tv/y'`;
  const { text: out, count } = rewriteHostInText(text, 'flashyelt.yayincilik.net');
  assert.strictEqual(count, 2);
  assert.strictEqual(out, `a: 'https://flashyelt.yayincilik.net/x', b: 'http://flashyelt.yayincilik.net/y'`);
});

test('rewriteHostInText: diğer host\'lara (dijitap.com, impark.com.tr) DOKUNMAZ', () => {
  const text = `sorucoz.tv, dijitap.com, impark.com.tr, localhost`;
  const { text: out, count } = rewriteHostInText(text, 'flashyelt.yayincilik.net');
  assert.strictEqual(count, 1);
  assert.ok(out.includes('dijitap.com'));
  assert.ok(out.includes('impark.com.tr'));
  assert.ok(out.includes('localhost'));
  assert.ok(!/sorucoz\.tv/i.test(out));
});

test('rewriteHostInText: publisherHost yoksa DOKUNMAZ (count 0)', () => {
  const { text: out, count } = rewriteHostInText('sorucoz.tv', null);
  assert.strictEqual(count, 0);
  assert.strictEqual(out, 'sorucoz.tv');
});

// --- applyPublisherDomainPatch (dosya sistemi) ---

test('applyPublisherDomainPatch: app.config.js + book1/ alt dosyası değişir, ikili dosya DOKUNULMAZ', async () => {
  const dir = tempBuildDir();
  try {
    const rootCfg = path.join(dir, 'app.config.js');
    fs.writeFileSync(
      rootCfg,
      `module.exports = { testSolutionVideo: { apiTemplate: 'https://flashyelt.yayincilik.net/api/{id}' }, updateEndPoint: 'https://www.sorucoz.tv/TestlerMobil/GetKitapGuncellemeBilgi' };`,
      'utf8'
    );
    fs.mkdirSync(path.join(dir, 'book1'));
    const bookCfg = path.join(dir, 'book1', 'set_app.config');
    fs.writeFileSync(bookCfg, `service: 'http://sorucoz.tv/svc'`, 'utf8');

    // ikili dosya — png binary imzası + İÇİNDE "sorucoz.tv" metni GÖMÜLÜ (bilerek).
    // Amaç: guard'ın gerçekten UZANTIYA göre atladığını kanıtlamak — içerikte
    // eşleşme OLMADIĞI için "değişmedi" demek yetmez (yanlış-pozitif geçer test
    // olur). Eşleşme VARKEN de değişmemesi guard'ı gerçekten kanıtlar.
    const binPath = path.join(dir, 'book1', 'logo.png');
    const pngBytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('www.sorucoz.tv', 'utf8'),
      Buffer.from([0x00, 0x00, 0xff, 0xd8])
    ]);
    fs.writeFileSync(binPath, pngBytes);

    const summary = await applyPublisherDomainPatch(dir, { log: () => {} });

    assert.strictEqual(summary.publisherHost, 'flashyelt.yayincilik.net');
    assert.strictEqual(summary.changed, true);
    assert.strictEqual(summary.filesChangedCount, 2, 'root config + book1 config değişmeli');
    assert.strictEqual(summary.totalReplacements, 2);

    const rootOut = fs.readFileSync(rootCfg, 'utf8');
    const bookOut = fs.readFileSync(bookCfg, 'utf8');
    assert.ok(!/sorucoz\.tv/i.test(rootOut), 'root config sorucoz.tv kalmamalı');
    assert.ok(rootOut.includes('flashyelt.yayincilik.net/TestlerMobil'));
    assert.ok(bookOut.includes('flashyelt.yayincilik.net'));

    const binOut = fs.readFileSync(binPath);
    assert.ok(binOut.equals(pngBytes), 'ikili dosya BAYT BAYT aynı kalmalı');
  } finally {
    cleanup(dir);
  }
});

test('applyPublisherDomainPatch: yayıncı host türetilemezse NO-OP (dosyalar DEĞİŞMEZ, tahmini host YAZILMAZ)', async () => {
  const dir = tempBuildDir();
  try {
    const cfg = path.join(dir, 'app.config.js');
    const original = `module.exports = { updateEndPoint: 'https://www.sorucoz.tv/Update' };`;
    fs.writeFileSync(cfg, original, 'utf8');

    const summary = await applyPublisherDomainPatch(dir, { log: () => {} });

    assert.strictEqual(summary.publisherHost, null);
    assert.strictEqual(summary.changed, false);
    assert.strictEqual(summary.filesChangedCount, 0);
    assert.strictEqual(fs.readFileSync(cfg, 'utf8'), original, 'host bulunamayınca dosya HİÇ değişmemeli');
  } finally {
    cleanup(dir);
  }
});

test('applyPublisherDomainPatch: İDEMPOTENT — ikinci koşu ek değişiklik üretmez', async () => {
  const dir = tempBuildDir();
  try {
    const cfg = path.join(dir, 'app.config.js');
    fs.writeFileSync(
      cfg,
      `module.exports = { testSolutionVideo: { apiTemplate: 'https://mec.yayincilik.net/api' }, u: 'https://www.sorucoz.tv/Update' };`,
      'utf8'
    );

    const first = await applyPublisherDomainPatch(dir, { log: () => {} });
    assert.strictEqual(first.changed, true);
    assert.strictEqual(first.totalReplacements, 1);
    const afterFirst = fs.readFileSync(cfg, 'utf8');

    const second = await applyPublisherDomainPatch(dir, { log: () => {} });
    assert.strictEqual(second.changed, false, 'ikinci koşu no-op olmalı');
    assert.strictEqual(second.filesChangedCount, 0);
    assert.strictEqual(second.publisherHost, 'mec.yayincilik.net', 'host ikinci koşuda da AYNI türetilmeli');
    assert.strictEqual(fs.readFileSync(cfg, 'utf8'), afterFirst, 'ikinci koşu sonrası içerik AYNI kalmalı');
  } finally {
    cleanup(dir);
  }
});

test('SORUCOZ_RE: modül dışına doğru export edilmiş regex (global flag ile)', () => {
  assert.ok(SORUCOZ_RE.global, 'global flag olmalı (çoklu occurrence için)');
  SORUCOZ_RE.lastIndex = 0;
});

// --- kaynak-sentinel: packagingService.js entegrasyonu ---

test('kaynak-sentinel: packagingService.js yayinci-domain-yamasi.js\'i require eder', () => {
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  assert.ok(
    src.includes("require('./yayinci-domain-yamasi')"),
    'packagingService.js yayinci-domain-yamasi modülünü require etmeli'
  );
});

test('kaynak-sentinel: applyPublisherDomainPatch çağrısı platform fan-out ÖNCESİNDE (tek nokta)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  const callIdx = src.indexOf('applyPublisherDomainPatch(workingPath');
  const loopIdx = src.indexOf('for (let i = 0; i < platforms.length; i++)');
  const switchIdx = src.indexOf("case 'windows':");

  assert.notStrictEqual(callIdx, -1, 'applyPublisherDomainPatch çağrısı bulunamadı');
  assert.notStrictEqual(loopIdx, -1);
  assert.notStrictEqual(switchIdx, -1);
  assert.ok(callIdx < loopIdx, 'çağrı, platform fan-out DÖNGÜSÜNDEN önce olmalı');
  assert.ok(callIdx < switchIdx, 'çağrı, switch(platform) ifadesinden önce olmalı');

  // Fan-out sapması YOK: dosyada TEK çağrı olmalı (3 platformda 3 ayrı çağrı değil).
  const occurrences = src.split('applyPublisherDomainPatch(workingPath').length - 1;
  assert.strictEqual(occurrences, 1, 'applyPublisherDomainPatch TEK bir noktadan çağrılmalı');
});

test('kaynak-sentinel: Windows HARİÇ gate\'i (platforms.filter) çağrıdan ÖNCE var', () => {
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  const gateIdx = src.indexOf("platforms.filter((p) => p !== 'windows')");
  const callIdx = src.indexOf('applyPublisherDomainPatch(workingPath');
  assert.notStrictEqual(gateIdx, -1, 'Windows-hariç gate ifadesi bulunamadı');
  assert.ok(gateIdx < callIdx, 'gate, çağrıdan ÖNCE değerlendirilmeli');
});

test('kaynak-sentinel: packageWindows fonksiyon gövdesinde applyPublisherDomainPatch çağrısı YOK', () => {
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  const startIdx = src.indexOf('async packageWindows(');
  assert.notStrictEqual(startIdx, -1, 'packageWindows bulunamadı');
  // Bir sonraki "async package" tanımına kadar olan gövdeyi al (packageLinux başlar).
  const nextFnIdx = src.indexOf('\n  async package', startIdx + 10);
  assert.notStrictEqual(nextFnIdx, -1, 'packageWindows sonrası bir sonraki fonksiyon bulunamadı');
  const body = src.slice(startIdx, nextFnIdx);
  assert.ok(!body.includes('applyPublisherDomainPatch'), 'packageWindows gövdesi bu adımı ÇAĞIRMAMALI');
});

test('kaynak-sentinel: packageAndroid ve packageLinux gövdeleri PAYLAŞILAN workingPath\'i (yamalı) kullanır — kendi ayrı çağrısı YOK (fan-out yok)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  const androidStart = src.indexOf('async packageAndroid(');
  const linuxStart = src.indexOf('async packageLinux(');
  assert.notStrictEqual(androidStart, -1);
  assert.notStrictEqual(linuxStart, -1);
  const androidBody = src.slice(androidStart, androidStart + 3000);
  const linuxBody = src.slice(linuxStart, linuxStart + 3000);
  assert.ok(!androidBody.includes('applyPublisherDomainPatch'), 'packageAndroid kendi ayrı çağrısını YAPMAMALI (fan-out yok, ortak nokta yeterli)');
  assert.ok(!linuxBody.includes('applyPublisherDomainPatch'), 'packageLinux kendi ayrı çağrısını YAPMAMALI (fan-out yok, ortak nokta yeterli)');
});
