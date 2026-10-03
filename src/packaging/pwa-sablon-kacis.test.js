'use strict';

// PWA / Service Worker şablonunda kaçış (escaping) sentinel'i.
// Tuhaf dosya/uygulama adlarıyla üretilen sw.js sözdizimi hatası vermemeli ve
// dosya listesi aynen geri okunabilmeli.

const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const os = require('node:os');
const path = require('node:path');
const fs = require('fs-extra');

const svc = require('./packagingService');

const SATIR_ADI = 'satir\nsonu.js';
const TUHAF_DOSYALAR = [
  "Teacher's Book.js",
  'a\\b.js',
  SATIR_ADI,
  'q"uote`tick${x}.js',
  'dolar$&$\'.js',
  'normal.js'
];
const TUHAF_APP = "Ev's */ App\nSatir2 \\ `x` ${y}";
const SURUM = "1.0.0'-b\\";

async function tuhafDizin() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pwa-kacis-'));
  for (const ad of TUHAF_DOSYALAR) await fs.writeFile(path.join(dir, ad), 'x');
  return dir;
}

function derle(metin) {
  // Sözdizimi hatası varsa SyntaxError fırlatır.
  return new vm.Script(metin, { filename: 'sw.js' });
}

test('gelişmiş sw.js: tuhaf ad ve dosyalarla derlenir, liste JSON olarak geri okunur', async () => {
  const dir = await tuhafDizin();
  try {
    const metin = await svc.generateAdvancedServiceWorker(TUHAF_APP, SURUM, dir);
    derle(metin);

    const m = metin.match(/const CRITICAL_FILES = (\[[\s\S]*?\]);\n/);
    assert.ok(m, 'CRITICAL_FILES bulunamadı');
    const liste = JSON.parse(m[1]);
    for (const ad of TUHAF_DOSYALAR) assert.ok(liste.includes('/' + ad), `eksik: ${ad}`);

    // Sürüm ve önbellek adı string olarak aynen geri okunur.
    const ctx = vm.createContext({ self: { addEventListener() {} }, console });
    const cacheAdi = TUHAF_APP.toLowerCase().replace(/\s+/g, '-') + '-v' + SURUM;
    assert.strictEqual(vm.runInContext(metin.replace(/^[\s\S]*?(?=const CACHE_NAME)/, '')
      .split('\n').slice(0, 1).join('\n') + '\nCACHE_NAME', ctx), cacheAdi);
    assert.ok(metin.includes(JSON.stringify(SURUM)), 'sürüm JSON string olarak gömülmedi');
  } finally {
    await fs.remove(dir);
  }
});

test('gelişmiş sw.js: normal adla içerik anlamca aynı (CACHE_NAME, liste)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pwa-kacis-'));
  try {
    await fs.writeFile(path.join(dir, 'index.html'), 'x');
    const metin = await svc.generateAdvancedServiceWorker('Kitap Bir', '2.1.0', dir);
    derle(metin);
    assert.match(metin, /^\/\/ Kitap Bir - Service Worker v2\.1\.0$/m);
    assert.match(metin, /const CACHE_NAME = "kitap-bir-v2\.1\.0";/);
    assert.match(metin, /const RUNTIME_CACHE = "kitap-bir-v2\.1\.0-runtime";/);
    assert.deepStrictEqual(
      JSON.parse(metin.match(/const CRITICAL_FILES = (\[[\s\S]*?\]);\n/)[1]),
      ['/index.html']
    );
  } finally {
    await fs.remove(dir);
  }
});

test('şablonlu generateServiceWorker: tuhaf adlarla derlenir, liste geri okunur', async () => {
  const dir = await tuhafDizin();
  const sablon = [
    '// {{APP_NAME}} - v{{APP_VERSION}}',
    "const CACHE_NAME = '{{CACHE_NAME}}';",
    "const PREFIX = '{{CACHE_PREFIX}}';",
    'const FILES = [',
    '{{CRITICAL_FILES_LIST}}',
    '];',
    ''
  ].join('\n');

  // sw-template.js depoda yok; okumayı yalnız o yol için taklit et.
  const gercek = fs.readFile;
  fs.readFile = async (p, ...a) =>
    String(p).endsWith('sw-template.js') ? sablon : gercek.call(fs, p, ...a);
  try {
    await svc.generateServiceWorker(dir, TUHAF_APP, SURUM);
  } finally {
    fs.readFile = gercek;
  }
  try {
    const metin = await fs.readFile(path.join(dir, 'sw.js'), 'utf-8');
    derle(metin);
    const ctx = vm.createContext({});
    const liste = vm.runInContext(metin + ';FILES', ctx);
    // generateServiceWorker yol ayracını '/' yapar (Windows göreli yolları): a\\b.js -> /a/b.js
    for (const ad of TUHAF_DOSYALAR) {
      assert.ok(liste.includes('/' + ad.replace(/\\/g, '/')), `eksik: ${ad}`);
    }
    // Dosya listesi tek parça JSON olarak da okunabilmeli.
    JSON.parse('[' + metin.match(/const FILES = \[\n([\s\S]*?)\n\];/)[1] + ']');
    const cacheAdi = TUHAF_APP.toLowerCase().replace(/\s+/g, '-') + '-v' + SURUM;
    assert.strictEqual(vm.runInContext('CACHE_NAME', ctx), cacheAdi);
  } finally {
    await fs.remove(dir);
  }
});

test('kurulum yardımcısı ve çevrimdışı sayfa: tuhaf adla derlenir, HTML kaçırılır', () => {
  const ad = "Ev's </title><b> \"x\" `t` ${y} \\ */\nS2";
  const yardimci = svc.generateInstallHelper(ad);
  derle(yardimci);
  const sayfa = svc.generateOfflinePage(ad);
  assert.ok(!sayfa.includes('</title><b>'), 'HTML kaçırılmadı');
  assert.match(sayfa, /<title>Ev&#39;s &lt;\/title&gt;&lt;b&gt;/);
});

test('jsYorum: satır sonu ve */ yorum bloğunu bozamaz', () => {
  const { jsYorum } = require('./pwa-kacis');
  const y = jsYorum('a */ b\nc\r\nd');
  assert.ok(!/\*\/|[\r\n]/.test(y));
  derle(`/* ${y} */ 1;`);
  derle(`// ${y}\n1;`);
});
