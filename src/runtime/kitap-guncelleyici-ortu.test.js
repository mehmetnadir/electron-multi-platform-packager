'use strict';

/**
 * G KANALI — ÖRTÜ KİPİ (macOS + Linux/Pardus) TESTLERİ (2026-09-26).
 *
 * Nadir'in kararı: G istemcisi tüm paketlerde; uzaktan değişenler kök index.html, set
 * bileşimi (bookN/ + menü), bookN/43e23fce2b7009474555a77.js. mac `.app` imzalı → gövdeye
 * yazılmaz, `~/Library/Application Support/<app>/empp-guncelleme` örtüsü; Pardus'ta kurulum
 * dizini (`<kurulum>/resources/empp-guncelleme`). "İmzası geçmeyen örtü dosyası YÜKLENMEZ."
 *
 * DİSİPLİN (kitap-guncelleyici.test.js ile aynı): dosya sistemi GERÇEK, ağ GERÇEK HTTP
 * (127.0.0.1 — güncelleyici http'yi yalnız loopback'te kabul eder). İmza anahtarı her koşuda
 * taze üretilir (üretim anahtarı teste girmez). https + dosyadaki TEST anahtarı ile üç durumlu
 * uçtan uca test: `kitap-guncelleyici-ortu-e2e.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const nodeUrl = require('node:url');

const kg = require('./kitap-guncelleyici');
const Y = require('./kitap-guncelleyici-ortu.yardimci');

const { publicKey: ACIK_K, privateKey: OZEL } = crypto.generateKeyPairSync('ed25519');
const ACIK = ACIK_K.export({ type: 'spki', format: 'der' }).toString('base64');
const imzala = (b) => crypto.sign(null, Buffer.from(b), OZEL).toString('base64');

const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `g-ortu-${ad}-`));
const sessiz = () => {};
const sha = (v) => kg.sha256(Buffer.from(v));

/** Paket (taban) iskeleti: SET kökü + empp-set.json (gömülü açık anahtar). */
function tabanKur(dosyalar = {}, setUzeri = {}) {
  const kok = tmp('taban');
  const hepsi = Object.assign({
    'index.html': '<html>ESKI MENU</html>',
    'config/settings.json': '{"books":{"book1":{},"book2":{}}}',
    'book1/index.html': '<html>kitap1</html>',
    'book1/43e23fce2b7009474555a77.js': '/* motor v1 */',
    'book1/assets/1/pages/1.png': 'PNG1',
    'book2/index.html': '<html>kitap2</html>',
    'book2/43e23fce2b7009474555a77.js': '/* motor v1 */',
    'main.js': 'app.whenReady()',
  }, dosyalar);
  for (const [y, v] of Object.entries(hepsi)) {
    fs.mkdirSync(path.dirname(path.join(kok, y)), { recursive: true });
    fs.writeFileSync(path.join(kok, y), v);
  }
  const set = Object.assign({
    sema: 2, setKimligi: '7001', taban: '', imza: { alg: 'ed25519', acikAnahtar: ACIK },
  }, setUzeri);
  fs.writeFileSync(path.join(kok, 'empp-set.json'), JSON.stringify(set));
  return { kok, set };
}

async function sunucu(rotalar) {
  const sayac = { yollar: [] };
  const s = http.createServer((istek, yanit) => {
    const yol = decodeURIComponent(istek.url.split('?')[0]);
    sayac.yollar.push(yol);
    const r = rotalar[yol];
    if (r == null) { yanit.statusCode = 404; yanit.end('yok'); return; }
    const g = Buffer.isBuffer(r) ? r : Buffer.from(typeof r === 'string' ? r : JSON.stringify(r));
    yanit.setHeader('content-length', String(g.length));
    yanit.end(g);
  });
  await new Promise((c) => s.listen(0, '127.0.0.1', c));
  const taban = 'http://127.0.0.1:' + s.address().port;
  return { taban, sayac, kapat: () => new Promise((c) => s.close(c)) };
}

/** Yayın: manifest + imza + dosyalar + arşivler → rota tablosu (sunucu tarafını taklit eder). */
function yayin(tabanUrl, secenek) {
  return Y.yayinRotalari(Object.assign({ tabanUrl, imzala, setKimligi: '7001' }, secenek));
}

async function guncelle(kok, set, ortuKoku, rotalarFn, ek = {}) {
  const son = await Y.sunucuKurVeYayinla(sunucu, rotalarFn);
  try {
    const r = await kg.guncellemeyiCalistir(Object.assign({
      taban: son.taban, set, kok, ortuKoku, zamanAsimi: 5000, gunluk: sessiz,
    }, ek));
    return { r, istekler: son.sayac.yollar };
  } finally { await son.kapat(); }
}

/* ---------------------------------------------------------------- kip kararı */

test('asarKoku: asar segmentini bulur, benzer adları karıştırmaz', () => {
  assert.strictEqual(kg.asarKoku('/A.app/Contents/Resources/app.asar'), '/A.app/Contents/Resources/app.asar');
  assert.strictEqual(kg.asarKoku('/A.app/Contents/Resources/app.asar/book1'), '/A.app/Contents/Resources/app.asar');
  assert.strictEqual(kg.asarKoku('/home/u/DijiTap/X/Kitap/resources/app.asar'), '/home/u/DijiTap/X/Kitap/resources/app.asar');
  assert.strictEqual(kg.asarKoku('/home/u/app.asarx/y'), null);
  assert.strictEqual(kg.asarKoku('C:\\Kitap\\resources\\app'), null);
});

test('kipBelirle: Windows YERİNDE (davranış değişmedi) — asar olsa da', () => {
  assert.deepStrictEqual(kg.kipBelirle({ kok: 'C:\\K\\resources\\app', platform: 'win32' }),
    { tur: 'yerinde', sebep: 'windows' });
  assert.strictEqual(kg.kipBelirle({ kok: 'C:\\K\\resources\\app.asar', platform: 'win32' }).tur, 'yerinde');
});

test('kipBelirle: mac → userData/empp-guncelleme (imzalı .app\'e yazılmaz; asar kapalı olsa da)', () => {
  const app = { getPath: (k) => (k === 'userData' ? '/Users/u/Library/Application Support/SM2 Set' : '') };
  const beklenen = path.join('/Users/u/Library/Application Support/SM2 Set', 'empp-guncelleme');
  const a = kg.kipBelirle({ kok: '/Applications/SM2 Set.app/Contents/Resources/app.asar', platform: 'darwin', app });
  assert.deepStrictEqual(a, { tur: 'ortu', ortuKoku: beklenen, kaynak: 'userData' });
  const b = kg.kipBelirle({ kok: '/Applications/SM2 Set.app/Contents/Resources/app', platform: 'darwin', app });
  assert.strictEqual(b.ortuKoku, beklenen);
  assert.strictEqual(kg.kipBelirle({ kok: '/x/app.asar', platform: 'darwin' }).tur, 'kapali', 'userData yoksa KAPALI');
});

test('kipBelirle: Pardus/Linux asar → kurulum dizini <resources>/empp-guncelleme, userData yedeği', () => {
  const app = { getPath: () => '/home/etapadmin/.config/SM2' };
  const k = kg.kipBelirle({ kok: '/home/etapadmin/DijiTap/DijiTap/SM2/resources/app.asar', platform: 'linux', app });
  assert.deepStrictEqual(k, {
    tur: 'ortu',
    ortuKoku: '/home/etapadmin/DijiTap/DijiTap/SM2/resources/empp-guncelleme',
    kaynak: 'kurulum',
    yedek: '/home/etapadmin/.config/SM2/empp-guncelleme',
  });
  assert.deepStrictEqual(kg.kipBelirle({ kok: '/opt/x/resources/app', platform: 'linux' }),
    { tur: 'yerinde', sebep: 'asar-yok' });
});

test('kipBelirle: açık örtü (parametre / EMPP_G_ORTU_KOKU) her şeyin önünde; düz Node → yerinde', () => {
  assert.strictEqual(kg.kipBelirle({ kok: '/k', platform: 'win32', ortuKoku: '/o' }).ortuKoku, path.resolve('/o'));
  assert.strictEqual(kg.kipBelirle({ kok: '/k', platform: null, env: { [kg.ORTU_ENV]: '/e' } }).ortuKoku, path.resolve('/e'));
  assert.strictEqual(kg.kipBelirle({ kok: '/tmp/paket', platform: null }).tur, 'yerinde');
});

test('kipCoz: kurulum dizini yazılamazsa userData yedeği; yedek de yoksa KAPALI', { skip: process.getuid && process.getuid() === 0 }, () => {
  const kurulum = tmp('kurulum');
  const res = path.join(kurulum, 'resources');
  fs.mkdirSync(res);
  fs.chmodSync(res, 0o555);
  try {
    const ud = tmp('ud');
    const electron = { app: { getPath: () => ud } };
    const k = kg.kipCoz({ kok: path.join(res, 'app.asar'), platform: 'linux', electron, env: {}, yenile: true });
    assert.deepStrictEqual(k, { tur: 'ortu', ortuKoku: path.join(ud, 'empp-guncelleme'), kaynak: 'userData-yedek' });
    const k2 = kg.kipCoz({ kok: path.join(res, 'app.asar'), platform: 'linux', electron: null, env: {}, yenile: true });
    assert.deepStrictEqual(k2, { tur: 'kapali', sebep: 'ortu-yazilamaz' });
  } finally { fs.chmodSync(res, 0o755); }
});

test('yazilabilirMi: olmayan yol en yakın ataya göre; dizin OLUŞTURMAZ', () => {
  const t = tmp('yaz');
  const hedef = path.join(t, 'a', 'b', 'empp-guncelleme');
  assert.strictEqual(kg.yazilabilirMi(hedef), true);
  assert.strictEqual(fs.existsSync(path.join(t, 'a')), false, 'yan etki olmamalı');
});

/* ------------------------------------------------------------ saf yardımcılar */

test('ortudeEtkisizMi: Node require ile yüklenenler + kanal durumu örtüde etkisiz', () => {
  for (const y of ['main.js', 'electron.js', 'package.json', 'empp-set.json', 'empp-set-guncelleyici.js',
    'empp-icerik-guncelleme.js', 'node_modules/x/i.js', 'empp-vendor/adm-zip/a.js', '.empp-x', 'a/.empp-gecici/b']) {
    assert.strictEqual(kg.ortudeEtkisizMi(y), true, y);
  }
  for (const y of ['index.html', 'book1/43e23fce2b7009474555a77.js', 'config/settings.json', 'book1/main.js']) {
    assert.strictEqual(kg.ortudeEtkisizMi(y), false, y);
  }
});

test('ortuDiziniGecerliMi: tek parça, gizli/etkisiz ad değil', () => {
  assert.strictEqual(kg.ortuDiziniGecerliMi('book7'), true);
  for (const d of ['book7/x', '../book7', '.gizli', 'node_modules', '', '/book7']) {
    assert.strictEqual(kg.ortuDiziniGecerliMi(d), false, d);
  }
});

test('nesneAdi: özet + küçük harf uzantı (Chromium MIME uzantıdan); tuhaf uzantı atılır', () => {
  const h = 'A'.repeat(64);
  assert.strictEqual(kg.nesneAdi(h, 'index.HTML'), 'a'.repeat(64) + '.html');
  assert.strictEqual(kg.nesneAdi(h, 'x.js.LICENSE.txt'), 'a'.repeat(64) + '.txt');
  assert.strictEqual(kg.nesneAdi(h, 'README'), 'a'.repeat(64));
  assert.strictEqual(kg.nesneAdi(h, 'a.<script>'), 'a'.repeat(64));
});

test('kitapDosyalariDogrula: eksik alan, kaçan yol, tekrar → null', () => {
  const ok = { yol: 'index.html', sha256: 'b'.repeat(64), boyut: 3 };
  assert.deepStrictEqual(kg.kitapDosyalariDogrula([ok]), [ok]);
  assert.strictEqual(kg.kitapDosyalariDogrula([]), null);
  assert.strictEqual(kg.kitapDosyalariDogrula([ok, ok]), null);
  assert.strictEqual(kg.kitapDosyalariDogrula([{ ...ok, yol: '../x' }]), null);
  assert.strictEqual(kg.kitapDosyalariDogrula([{ ...ok, sha256: 'x' }]), null);
});

/* ------------------------------------------------------- güncelleyici: örtü */

const YENI_INDEX = '<html>YENI MENU v2</html>';
const YENI_MOTOR = '/* motor v2 — kanonik */';
const KITAP3 = {
  'index.html': '<html>kitap3</html>',
  '43e23fce2b7009474555a77.js': '/* motor v2 — kanonik */',
  'assets/9/pages/1.png': 'PNG9',
};

function tamYayin(t, ek = {}) {
  return yayin(t, Object.assign({
    surum: 's2',
    kabuk: {
      'index.html': YENI_INDEX,
      'config/settings.json': '{"books":{"book1":{},"book3":{}}}',
      'book1/43e23fce2b7009474555a77.js': YENI_MOTOR,
      'book1/index.html': '<html>kitap1</html>', // paketteki ile AYNI → inmez
    },
    kitaplar: [{ dizin: 'book2', durum: 'cikar' }, { dizin: 'book3', durum: 'ekle', dosyalar: KITAP3 }],
  }, ek));
}

test('ÖRTÜ: imzalı manifest → index + book1/43e23 + settings örtüye, book3 eklenir, book2 gizlenir; GÖVDE DOKUNULMAZ', async () => {
  const { kok, set } = tabanKur();
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  const once = Y.agacOzeti(kok);
  const { r, istekler } = await guncelle(kok, set, ortuKoku, (t) => tamYayin(t));
  assert.strictEqual(r.durum, 'guncellendi', JSON.stringify(r));
  assert.strictEqual(r.mod, 'ortu');
  // index + settings iner. book1/43e23 İNMEZ: aynı içerik book3 arşivinden zaten nesne oldu
  // (içerik-adresli tekilleştirme); book1/index.html paketteki ile aynı → inmez.
  assert.strictEqual(r.kabukIndirilen, 2, JSON.stringify(r.sira));
  assert.ok(!istekler.includes('/set/7001/dosya/book1/index.html'));
  assert.ok(!istekler.includes('/set/7001/dosya/book1/43e23fce2b7009474555a77.js'));
  assert.deepStrictEqual(r.eklenen, ['book3']);
  assert.deepStrictEqual(r.cikarilan, ['book2']);
  assert.deepStrictEqual(Y.agacOzeti(kok), once, 'paket gövdesine TEK BAYT yazılmamalı');
  const d = kg.ortuDurumuYukle({ kok, ortuKoku });
  assert.strictEqual(d.gecerli, true, d.sebep);
  assert.strictEqual(d.surum, 's2');
  const oku = (rel) => {
    const c = kg.ortuCoz(d, rel);
    if (!c) return ['taban', fs.readFileSync(path.join(kok, rel), 'utf8')];
    if (c.tur === 'yok') return ['yok'];
    return ['ortu', fs.readFileSync(c.yol, 'utf8')];
  };
  assert.deepStrictEqual(oku('index.html'), ['ortu', YENI_INDEX]);
  assert.deepStrictEqual(oku('book1/43e23fce2b7009474555a77.js'), ['ortu', YENI_MOTOR]);
  assert.deepStrictEqual(oku('book1/index.html'), ['taban', '<html>kitap1</html>']);
  assert.deepStrictEqual(oku('book1/assets/1/pages/1.png'), ['taban', 'PNG1']);
  assert.deepStrictEqual(oku('book2/index.html'), ['yok'], 'çıkarılan kitap sunulmaz');
  assert.deepStrictEqual(oku('book3/index.html'), ['ortu', '<html>kitap3</html>']);
  assert.deepStrictEqual(oku('book3/assets/9/pages/1.png'), ['ortu', 'PNG9']);
  assert.deepStrictEqual(oku('book3/listede-yok.js'), ['yok'], 'eklenen kitapta listesiz dosya sunulmaz');
});

test('ÖRTÜ: aynı sürüm ikinci koşuda → "guncel", manifest indirilmez', async () => {
  const { kok, set } = tabanKur();
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  await guncelle(kok, set, ortuKoku, (t) => tamYayin(t));
  const { r, istekler } = await guncelle(kok, set, ortuKoku, (t) => tamYayin(t));
  assert.strictEqual(r.durum, 'guncel');
  assert.deepStrictEqual(istekler, ['/set/7001/surum.json']);
});

test('ÖRTÜ: manifest yok (surum.json 404) → hiçbir şey olmaz: örtü dizini OLUŞMAZ, hata yok', async () => {
  const { kok, set } = tabanKur();
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  const { r } = await guncelle(kok, set, ortuKoku, () => ({}));
  assert.strictEqual(r.durum, 'atlandi');
  assert.match(r.sebep, /^surum-alinamadi:durum-404/);
  assert.strictEqual(r.hata, '');
  assert.strictEqual(fs.existsSync(ortuKoku), false);
});

test('ÖRTÜ: imza bozuk → reddedilir, örtüye tek dosya yazılmaz', async () => {
  const { kok, set } = tabanKur();
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  const { r } = await guncelle(kok, set, ortuKoku, (t) => tamYayin(t, { imzaBoz: true }));
  assert.strictEqual(r.sebep, 'manifest-alinamadi:manifest-imzasi-gecersiz');
  assert.strictEqual(fs.existsSync(ortuKoku), false);
});

test('ÖRTÜ: eklenen kitapta imzalı dosya listesi yoksa → kısmi, örtü değişmez (imzasız dosya sunulmaz)', async () => {
  const { kok, set } = tabanKur();
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  const { r } = await guncelle(kok, set, ortuKoku, (t) => tamYayin(t, { dosyalarSil: 'book3' }));
  assert.strictEqual(r.durum, 'kismi');
  assert.strictEqual(r.sebep, 'uyelik-eksik-kabuk-atlandi');
  assert.strictEqual(fs.existsSync(path.join(ortuKoku, kg.ORTU_ETKIN)), false);
});

test('ÖRTÜ: arşivde listede olmayan dosya / içerik listeyle uyuşmuyor → kısmi, etkin yazılmaz', async () => {
  for (const bozuk of ['fazla', 'icerik']) {
    const { kok, set } = tabanKur();
    const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
    const { r } = await guncelle(kok, set, ortuKoku, (t) => tamYayin(t, { arsivBoz: { book3: bozuk } }));
    assert.strictEqual(r.durum, 'kismi', bozuk);
    assert.strictEqual(fs.existsSync(path.join(ortuKoku, kg.ORTU_ETKIN)), false, bozuk);
  }
});

test('ÖRTÜ: yarım güncelleme (bir kabuk dosyası 404) ESKİ örtüyü bozmaz — eski sürüm sunulmaya devam eder', async () => {
  const { kok, set } = tabanKur();
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  await guncelle(kok, set, ortuKoku, (t) => tamYayin(t));
  const { r } = await guncelle(kok, set, ortuKoku, (t) => tamYayin(t, {
    surum: 's3', kabuk: { 'index.html': '<html>v3</html>' }, dosyaSil: ['index.html'],
  }));
  assert.strictEqual(r.durum, 'kismi');
  const d = kg.ortuDurumuYukle({ kok, ortuKoku });
  assert.strictEqual(d.gecerli, true, d.sebep);
  assert.strictEqual(d.surum, 's2');
  assert.strictEqual(fs.readFileSync(kg.ortuCoz(d, 'index.html').yol, 'utf8'), YENI_INDEX);
});

test('ÖRTÜ: index pakettekine geri dönerse örtü kopyası bırakılır ve BUDANIR (oturumda sunulmuyorsa)', async () => {
  const { kok, set } = tabanKur();
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  await guncelle(kok, set, ortuKoku, (t) => tamYayin(t));
  const eskiNesne = path.join(ortuKoku, 'nesne', kg.nesneAdi(sha(YENI_INDEX), 'index.html'));
  assert.ok(fs.existsSync(eskiNesne));
  const { r } = await guncelle(kok, set, ortuKoku, (t) => yayin(t, {
    surum: 's4', kabuk: { 'index.html': '<html>ESKI MENU</html>' }, kitaplar: [],
  }));
  assert.strictEqual(r.durum, 'guncellendi', JSON.stringify(r));
  assert.strictEqual(r.kabukIndirilen, 0);
  const d = kg.ortuDurumuYukle({ kok, ortuKoku });
  assert.strictEqual(kg.ortuCoz(d, 'index.html'), null, 'paketteki sunulur');
  assert.strictEqual(kg.ortuCoz(d, 'book2/index.html'), null, 'kümülatif: book2 artık gizli değil');
  assert.strictEqual(fs.existsSync(eskiNesne), false, 'kullanılmayan nesne budanmalı');
});

test('ÖRTÜ: manifestteki etkisiz yollar (main.js, empp-set.json, node_modules) atlanır, başarısızlık sayılmaz', async () => {
  const { kok, set } = tabanKur();
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  const { r } = await guncelle(kok, set, ortuKoku, (t) => yayin(t, {
    surum: 's5',
    kabuk: { 'index.html': YENI_INDEX, 'main.js': 'kötü()', 'empp-set.json': '{}', 'node_modules/a/i.js': 'x' },
    kitaplar: [],
  }));
  assert.strictEqual(r.durum, 'guncellendi', JSON.stringify(r));
  assert.strictEqual(r.ortuEtkisiz, 3);
  const d = kg.ortuDurumuYukle({ kok, ortuKoku });
  assert.strictEqual(kg.ortuCoz(d, 'main.js'), null);
  assert.strictEqual(kg.ortuCoz(d, 'empp-set.json'), null);
});

test('guncellemeyiBaslat: EMPP_G_ORTU_KOKU verilince örtü kipi — paket köküne yazmaz, damga yazmaz', async () => {
  const { kok } = tabanKur();
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  const once = Y.agacOzeti(kok);
  const son = await Y.sunucuKurVeYayinla(sunucu, (t) => tamYayin(t));
  try {
    const r = await kg.guncellemeyiBaslat({
      kok, gunluk: sessiz, env: { EMPP_GUNCELLEME_TABANI: son.taban, [kg.ORTU_ENV]: ortuKoku },
    });
    assert.strictEqual(r.durum, 'guncellendi', JSON.stringify(r));
    assert.deepStrictEqual(Y.agacOzeti(kok), once);
    assert.ok(!fs.existsSync(path.join(kok, kg.DAMGA_ADI)));
    assert.strictEqual(kg.ortuDurumuYukle({ kok, ortuKoku }).gecerli, true);
  } finally { await son.kapat(); }
});

/* ------------------------------------------- sunum: İMZASI GEÇMEYEN YÜKLENMEZ */

async function kurulmusOrtu() {
  const { kok, set } = tabanKur();
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  const { r } = await guncelle(kok, set, ortuKoku, (t) => tamYayin(t));
  assert.strictEqual(r.durum, 'guncellendi');
  return { kok, set, ortuKoku, etkinYolu: path.join(ortuKoku, kg.ORTU_ETKIN) };
}
const etkinOku = (y) => JSON.parse(fs.readFileSync(y, 'utf8'));
const etkinYaz = (y, e) => fs.writeFileSync(y, JSON.stringify(e));

test('SUNUM: kabuk nesnesi bozulursa örtünün TAMAMI yüklenmez (karışık menü/motor yok)', async () => {
  const o = await kurulmusOrtu();
  fs.writeFileSync(path.join(o.ortuKoku, 'nesne', kg.nesneAdi(sha(YENI_INDEX), 'index.html')), '<html>KÖTÜ!!!!!!!!</html>');
  const d = kg.ortuDurumuYukle({ kok: o.kok, ortuKoku: o.ortuKoku });
  assert.strictEqual(d.gecerli, false);
  assert.strictEqual(d.sebep, 'nesne-bozuk:index.html');
  assert.strictEqual(kg.ortuCoz(d, 'book1/43e23fce2b7009474555a77.js'), null);
  assert.strictEqual(kg.ortuCoz(d, 'book2/index.html'), null, 'geçersiz örtü gizleme de yapmaz');
});

test('SUNUM: etkin.json imzası değiştirilirse → imza-gecersiz, hiçbir örtü dosyası sunulmaz', async () => {
  const o = await kurulmusOrtu();
  const e = etkinOku(o.etkinYolu);
  e.imza = imzala('başka bir şey');
  etkinYaz(o.etkinYolu, e);
  const d = kg.ortuDurumuYukle({ kok: o.kok, ortuKoku: o.ortuKoku });
  assert.strictEqual(d.sebep, 'imza-gecersiz');
  assert.strictEqual(kg.ortuCoz(d, 'index.html'), null);
});

test('SUNUM: manifest nesnesi değiştirilirse (yeniden imzasız) → manifest-bozuk', async () => {
  const o = await kurulmusOrtu();
  const e = etkinOku(o.etkinYolu);
  fs.appendFileSync(path.join(o.ortuKoku, 'nesne', e.manifest), ' ');
  assert.strictEqual(kg.ortuDurumuYukle({ kok: o.kok, ortuKoku: o.ortuKoku }).sebep, 'manifest-bozuk');
});

test('SUNUM: elle eklenmiş örtü yolu / üyelik listesi → etkin-uyusmaz; nesnesi olmayan yol → nesne-bozuk', async () => {
  const o = await kurulmusOrtu();
  const e = etkinOku(o.etkinYolu);
  etkinYaz(o.etkinYolu, { ...e, ortuYollari: [...e.ortuYollari, 'book1/index.html'] });
  assert.strictEqual(kg.ortuDurumuYukle({ kok: o.kok, ortuKoku: o.ortuKoku }).sebep, 'nesne-bozuk:book1/index.html');
  etkinYaz(o.etkinYolu, { ...e, ortuYollari: [...e.ortuYollari, 'core/manifestte-yok.js'] });
  assert.strictEqual(kg.ortuDurumuYukle({ kok: o.kok, ortuKoku: o.ortuKoku }).sebep, 'etkin-uyusmaz');
  etkinYaz(o.etkinYolu, { ...e, cikarilan: [] });
  assert.strictEqual(kg.ortuDurumuYukle({ kok: o.kok, ortuKoku: o.ortuKoku }).sebep, 'etkin-uyusmaz');
});

test('SUNUM: yeni paket kuruldu (empp-set.json değişti) → taban-degisti; set kimliği farklı → reddedilir', async () => {
  const o = await kurulmusOrtu();
  fs.writeFileSync(path.join(o.kok, 'empp-set.json'), JSON.stringify({ ...o.set, damga: 'yeni-paket' }));
  assert.strictEqual(kg.ortuDurumuYukle({ kok: o.kok, ortuKoku: o.ortuKoku }).sebep, 'taban-degisti');
  const o2 = await kurulmusOrtu();
  assert.strictEqual(kg.ortuDurumuYukle({ kok: o2.kok, ortuKoku: o2.ortuKoku, set: { ...o2.set, setKimligi: '9' } }).sebep,
    'set-kimligi-farkli');
});

test('SUNUM: pakette açık anahtar yoksa örtü yüklenmez', async () => {
  const o = await kurulmusOrtu();
  const d = kg.ortuDurumuYukle({ kok: o.kok, ortuKoku: o.ortuKoku, set: { ...o.set, imza: null } });
  assert.strictEqual(d.sebep, 'imza-anahtari-yok');
});

test('SUNUM: eklenen kitabın nesnesi sonradan bozulursa o dosya 404 (paketin eski kopyasına da düşmez)', async () => {
  const o = await kurulmusOrtu();
  const d = kg.ortuDurumuYukle({ kok: o.kok, ortuKoku: o.ortuKoku });
  assert.strictEqual(d.gecerli, true);
  fs.writeFileSync(path.join(o.ortuKoku, 'nesne', kg.nesneAdi(sha('PNG9'), 'x.png')), 'KÖT');
  assert.deepStrictEqual(kg.ortuCoz(d, 'book3/assets/9/pages/1.png'), { tur: 'yok' });
  assert.strictEqual(kg.ortuCoz(d, 'book3/index.html').tur, 'ortu');
});

test('SUNUM: ortuCozMutlak paket kökü dışını / kaçan yolu reddeder', async () => {
  const o = await kurulmusOrtu();
  const d = kg.ortuDurumuYukle({ kok: o.kok, ortuKoku: o.ortuKoku });
  assert.strictEqual(kg.ortuCozMutlak(d, o.kok, '/etc/passwd'), null);
  assert.strictEqual(kg.ortuCozMutlak(d, o.kok, path.join(o.kok, '..', 'index.html')), null);
  assert.strictEqual(kg.ortuCozMutlak(d, o.kok, path.join(o.kok, 'index.html')).tur, 'ortu');
});

/* ------------------------------------------------- ana süreç: ortuSunucusunuKur */

function sahteElectron(ud) {
  const app = new EventEmitter();
  app.isReady = () => false;
  app.getPath = () => ud;
  const kayitlar = [];
  let h = null;
  const protocol = { interceptFileProtocol: (s, fn) => { kayitlar.push(s); h = fn; return true; } };
  return { electron: { app, protocol, net: {} }, kayitlar, istek: (p) => { let o; h({ url: nodeUrl.pathToFileURL(p).toString() }, (x) => { o = x; }); return o; } };
}

test('ortuSunucusunuKur: örtü yoksa protokole DOKUNMAZ (manifest yok → hiçbir şey olmaz)', () => {
  const { kok } = tabanKur();
  const s = sahteElectron(tmp('ud'));
  const kapsam = {};
  const r = kg.ortuSunucusunuKur({ electron: s.electron, kok, platform: 'darwin', env: {}, kapsam });
  assert.strictEqual(r.durum, 'ortu-bos');
  s.electron.app.emit('ready');
  assert.deepStrictEqual(s.kayitlar, []);
  assert.strictEqual(kapsam[kg.ZINCIR_ANAHTARI], undefined, 'zincir bile kurulmamalı');
});

test('ortuSunucusunuKur: geçerli örtü ready\'de (pencereden önce) kurulur; index/43e23 örtüden, book2 404', async () => {
  const o = await kurulmusOrtu();
  const s = sahteElectron('/yok');
  const kapsam = {};
  const sirasi = [];
  s.electron.app.on('ready', () => sirasi.push('yayinci-createWindow'));
  const r = kg.ortuSunucusunuKur({ electron: s.electron, kok: o.kok, ortuKoku: o.ortuKoku, env: {}, kapsam, gunluk: sessiz });
  assert.strictEqual(r.durum, 'bekliyor');
  s.electron.app.on('ready', () => sirasi.push('sonra'));
  s.electron.app.emit('ready');
  assert.strictEqual(r.durum, 'kuruldu', r.sebep);
  assert.deepStrictEqual(s.kayitlar, ['file']);
  assert.strictEqual(fs.readFileSync(s.istek(path.join(o.kok, 'index.html')).path, 'utf8'), YENI_INDEX);
  assert.strictEqual(fs.readFileSync(s.istek(path.join(o.kok, 'book1', '43e23fce2b7009474555a77.js')).path, 'utf8'), YENI_MOTOR);
  assert.deepStrictEqual(s.istek(path.join(o.kok, 'book2', 'index.html')), { error: kg.NET_DOSYA_YOK });
  assert.deepStrictEqual(s.istek(path.join(o.kok, 'book1', 'index.html')), { path: path.join(o.kok, 'book1', 'index.html') });
  assert.ok(fs.readFileSync(path.join(o.ortuKoku, kg.ORTU_GUNLUK), 'utf8').includes('örtü etkin'));
});

test('ortuSunucusunuKur: bozuk örtü → "gecersiz", kanca KURULMAZ, paket aynen sunulur', async () => {
  const o = await kurulmusOrtu();
  const e = etkinOku(o.etkinYolu);
  e.imza = imzala('x');
  etkinYaz(o.etkinYolu, e);
  const s = sahteElectron('/yok');
  const r = kg.ortuSunucusunuKur({ electron: s.electron, kok: o.kok, ortuKoku: o.ortuKoku, env: {}, kapsam: {}, gunluk: sessiz });
  s.electron.app.emit('ready');
  assert.strictEqual(r.durum, 'gecersiz');
  assert.strictEqual(r.sebep, 'imza-gecersiz');
  assert.deepStrictEqual(s.kayitlar, []);
});

test('ortuSunucusunuKur: EMPP_SET_GUNCELLEME=0 → kapalı (örtü de sunulmaz)', async () => {
  const o = await kurulmusOrtu();
  const s = sahteElectron('/yok');
  const r = kg.ortuSunucusunuKur({ electron: s.electron, kok: o.kok, ortuKoku: o.ortuKoku, env: { EMPP_SET_GUNCELLEME: '0' }, kapsam: {} });
  assert.strictEqual(r.durum, 'kapali');
});

test('BUDAMA: bu oturumda sunulan örtünün nesneleri, oturum ortasındaki güncellemede SİLİNMEZ', async () => {
  const o = await kurulmusOrtu();
  const s = sahteElectron('/yok');
  kg.ortuSunucusunuKur({ electron: s.electron, kok: o.kok, ortuKoku: o.ortuKoku, env: {}, kapsam: {}, gunluk: sessiz });
  s.electron.app.emit('ready');
  const eski = path.join(o.ortuKoku, 'nesne', kg.nesneAdi(sha(YENI_INDEX), 'index.html'));
  const { r } = await guncelle(o.kok, o.set, o.ortuKoku, (t) => yayin(t, {
    surum: 's6', kabuk: { 'index.html': '<html>v6</html>' }, kitaplar: [],
  }));
  assert.strictEqual(r.durum, 'guncellendi');
  assert.ok(fs.existsSync(eski), 'oturumdaki nesne korunmalı');
  assert.strictEqual(fs.readFileSync(s.istek(path.join(o.kok, 'index.html')).path, 'utf8'), YENI_INDEX,
    'yeni durum SONRAKİ açılışta: bu oturum eski menüyü sunmaya devam eder');
});
