'use strict';
/**
 * G — Java katmanının (EmppGKatman + EmppGRota) birim testleri Mac JVM'inde koşar; ayrıca
 * dayandığımız Capacitor 7 davranışı kaynaktan ÇİVİLENİR (sürüm yükselince sessizce bozulmasın).
 * JDK yoksa test ATLANIR ve bunu yazar (sessiz geçiş yok).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const G = path.join(__dirname, 'g-java');
const CAP = path.join(__dirname, '..', '..', '..', 'node_modules', '@capacitor', 'android', 'capacitor', 'src',
  'main', 'java', 'com', 'getcapacitor');

function jdkBul() {
  const adaylar = [
    process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin'),
    '/opt/homebrew/opt/openjdk@21/bin',
    '/usr/local/opt/openjdk@21/bin',
    '/opt/homebrew/opt/openjdk@17/bin',
    '/usr/local/opt/openjdk@17/bin',
  ].filter(Boolean);
  for (const d of adaylar) {
    if (fs.existsSync(path.join(d, 'javac')) && fs.existsSync(path.join(d, 'java'))) return d;
  }
  return null;
}

function javaDosyalari(kok) {
  const out = [];
  for (const g of fs.readdirSync(kok, { withFileTypes: true })) {
    const t = path.join(kok, g.name);
    if (g.isDirectory()) out.push(...javaDosyalari(t));
    else if (g.name.endsWith('.java')) out.push(t);
  }
  return out;
}

test('G Java: EmppGKatman + EmppGRota JVM birim testleri (60+ madde) geçer', (t) => {
  const jdk = jdkBul();
  if (!jdk) { t.skip('JDK yok — Java birim testleri KOŞMADI'); return; }
  const cikti = fs.mkdtempSync(path.join(os.tmpdir(), 'emppg-jv-'));
  const kaynaklar = [
    ...javaDosyalari(path.join(G, 'test', 'stub')),
    path.join(G, 'com', 'empp', 'g', 'EmppGKatman.java'),
    path.join(G, 'com', 'empp', 'g', 'EmppGRota.java'),
    path.join(G, 'test', 'com', 'empp', 'g', 'EmppGTest.java'),
  ];
  const d = spawnSync(path.join(jdk, 'javac'), ['-encoding', 'UTF-8', '-nowarn', '-d', cikti, ...kaynaklar],
    { encoding: 'utf8', timeout: 180000 });
  assert.strictEqual(d.status, 0, `javac düştü:\n${d.stderr}`);
  const k = spawnSync(path.join(jdk, 'java'), ['-cp', cikti, 'com.empp.g.EmppGTest'], { encoding: 'utf8', timeout: 120000 });
  const son = /SONUC gecti=(\d+) kaldi=(\d+)/.exec(k.stdout || '');
  assert.ok(son, `sonuç satırı yok:\n${k.stdout}\n${k.stderr}`);
  assert.strictEqual(Number(son[2]), 0, `kalan Java testi var:\n${(k.stdout || '').split('\n').filter((l) => l.startsWith('KALDI')).join('\n')}`);
  assert.ok(Number(son[1]) >= 60, `beklenenden az Java testi koştu (${son[1]})`);
  assert.strictEqual(k.status, 0);
});

test('G Java: eklenti/rota Capacitor sınıflarına uygun imzayla yazılmış (kaynak çivisi)', () => {
  const rota = fs.readFileSync(path.join(G, 'com', 'empp', 'g', 'EmppGRota.java'), 'utf8');
  const eklenti = fs.readFileSync(path.join(G, 'com', 'empp', 'g', 'EmppGPlugin.java'), 'utf8');
  assert.match(rota, /implements RouteProcessor/);
  assert.match(rota, /public ProcessedRoute process\(String basePath, String path\)/);
  assert.match(eklenti, /@CapacitorPlugin\(name = "EmppG"\)/);
  for (const y of ['yapilandirma', 'durum', 'getir', 'ozetler', 'yaz', 'kitapKur', 'uygula']) {
    assert.match(eklenti, new RegExp(`@PluginMethod\\s+public void ${y}\\(`), `eklenti yöntemi yok: ${y}`);
  }
  // PluginCall.getLong yalnız Long tanır; JSON küçük sayısı Integer gelir → varsayılana düşerdi.
  assert.doesNotMatch(eklenti, /call\.getLong\(/, 'getLong tuzağı: sayi() kullanılmalı');
  // Çekirdek saf JDK kalmalı (Mac JVM'inde sınanabilsin).
  const cekirdek = fs.readFileSync(path.join(G, 'com', 'empp', 'g', 'EmppGKatman.java'), 'utf8');
  assert.doesNotMatch(cekirdek, /^import android\./m, 'EmppGKatman android.* ithal etmemeli');
});

test('Capacitor sözleşmesi: RouteProcessor kancası ve dosya öneki davranışı (7.x kaynaktan)', (t) => {
  if (!fs.existsSync(path.join(CAP, 'WebViewLocalServer.java'))) { t.skip('@capacitor/android kaynağı yok'); return; }
  const rp = fs.readFileSync(path.join(CAP, 'RouteProcessor.java'), 'utf8');
  assert.match(rp, /ProcessedRoute process\(String basePath, String path\);/);
  const br = fs.readFileSync(path.join(CAP, 'Bridge.java'), 'utf8');
  assert.match(br, /public static final String CAPACITOR_FILE_START = "\/_capacitor_file_";/);
  assert.match(br, /public Builder setRouteProcessor\(RouteProcessor routeProcessor\)/);
  const ba = fs.readFileSync(path.join(CAP, 'BridgeActivity.java'), 'utf8');
  assert.match(ba, /protected final Bridge\.Builder bridgeBuilder/);
  const ls = fs.readFileSync(path.join(CAP, 'WebViewLocalServer.java'), 'utf8');
  // Dosya isteği: öneki `isAsset`'ten ÖNCE denetleniyor → paylaşılan alanı değiştirmeden dosya açabiliriz.
  const i1 = ls.indexOf('} else if (path.startsWith(capacitorFileStart)) {');
  const i2 = ls.indexOf('} else if (!isAsset) {');
  assert.ok(i1 > 0 && i2 > i1, 'capacitorFileStart dalı isAsset dalından önce olmalı');
  assert.match(ls, /getRouteProcessor\(\)\.process\(this\.basePath, "\/index\.html"\)/);
  assert.match(ls, /getRouteProcessor\(\)\.process\("", path\)/);
  const ph = fs.readFileSync(path.join(CAP, 'AndroidProtocolHandler.java'), 'utf8');
  assert.match(ph, /filePath\.replace\(Bridge\.CAPACITOR_FILE_START, ""\)/);
});
