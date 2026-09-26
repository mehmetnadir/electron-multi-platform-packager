'use strict';

/**
 * G GÜVENLİK TESTLERİ (2026-09-26) — G yayın ajanının kurulu Windows istemcisinde bulduğu üç
 * açık + birikimli manifest yeniden indirmesi, TÜM kiplerde:
 *   (1) monoton sürüm: imzalı ama kurulu sürümden KESİN büyük olmayan manifest reddedilir;
 *   (2) set kimliği / kanal: başka setin (ya da kanalın) imzalı manifesti reddedilir;
 *   (3) ya hep ya hiç: tek bozuk dosya → canlı ağaca hiç dokunulmaz; uygulama ortasında düşen
 *       rename ve çöken süreç (günce) geri sarılır;
 *   (4) aynı sha256'lı `ekle` arşivi yeniden indirilmez; kural 8 (kitapsız `bookN/…` atlanır).
 * Dosya sistemi ve HTTP GERÇEK (geçici dizin + loopback sunucu); yalnız hata enjeksiyonu için
 * `fs` sarmalanır.
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const kg = require('./kitap-guncelleyici');
const Y = require('./kitap-guncelleyici-ortu.yardimci');

const { publicKey: AK, privateKey: OZEL } = crypto.generateKeyPairSync('ed25519');
const ACIK = AK.export({ type: 'spki', format: 'der' }).toString('base64');
const imzala = (b) => crypto.sign(null, Buffer.from(b), OZEL).toString('base64');
const sessiz = () => {};
const MOTOR = '43e23fce2b7009474555a77.js';

const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), 'empp-gv-' + ad + '-'));

/** Kurulu paket: index v1, book1..2 (motor v1), package.json (sürüm), empp-set.json. */
function paketKur({ surum = '2.5.3', setKimligi = '9001', ek = {} } = {}) {
  const kok = tmp('paket');
  const dosyalar = Object.assign({
    'index.html': '<html>MENU v1: book1 book2</html>',
    'book1/index.html': '<html>kitap1</html>',
    [`book1/${MOTOR}`]: '/* motor v1 */',
    'book2/index.html': '<html>kitap2</html>',
    [`book2/${MOTOR}`]: '/* motor v1 */',
    'package.json': JSON.stringify({ name: 'gv', version: surum }),
  }, ek);
  for (const [y, v] of Object.entries(dosyalar)) {
    fs.mkdirSync(path.dirname(path.join(kok, y)), { recursive: true });
    fs.writeFileSync(path.join(kok, y), v);
  }
  const set = { sema: 2, setKimligi, taban: '', imza: { alg: 'ed25519', acikAnahtar: ACIK } };
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
  return { taban: 'http://127.0.0.1:' + s.address().port, sayac, kapat: () => new Promise((c) => s.close(c)) };
}

/** Yayın + koşu. `bozRotalar(rotalar)` imzadan SONRA uç içeriğini bozabilir (sunucu tarafı). */
async function kos(kok, set, secenek, ek = {}) {
  const son = await Y.sunucuKurVeYayinla(sunucu, (t) => {
    const r = Y.yayinRotalari(Object.assign({ tabanUrl: t, imzala, setKimligi: set.setKimligi }, secenek));
    if (typeof secenek.bozRotalar === 'function') secenek.bozRotalar(r);
    return r;
  });
  try {
    const r = await kg.guncellemeyiCalistir(Object.assign({
      taban: son.taban, set, kok, zamanAsimi: 5000, gunluk: sessiz,
    }, ek));
    return { r, istekler: son.sayac.yollar };
  } finally { await son.kapat(); }
}

/** Kurulu ağacın özeti; kanal durum dosyaları (damga, geçici) HARİÇ. */
function ozet(kok) {
  const o = Y.agacOzeti(kok);
  for (const y of Object.keys(o)) if (y === kg.DAMGA_ADI || y.startsWith(kg.GECICI_DIZIN + '/')) delete o[y];
  return o;
}
const oku = (kok, y) => { try { return fs.readFileSync(path.join(kok, y), 'utf8'); } catch (e) { return null; } };

/** Tam yayın: yeni menü + book1 motoru + book4 eklenir + book2 çıkar. */
const YENI_INDEX = '<html>MENU v2: book1 book4</html>';
const YENI_MOTOR = '/* motor v2 */';
function tam(surum, ek = {}) {
  return Object.assign({
    surum,
    kabuk: { 'index.html': YENI_INDEX, [`book1/${MOTOR}`]: YENI_MOTOR },
    kitaplar: [
      { dizin: 'book2', durum: 'cikar' },
      { dizin: 'book4', durum: 'ekle', dosyalar: { 'index.html': '<html>kitap4</html>', [MOTOR]: YENI_MOTOR } },
    ],
    listesiz: true, // G yayın aracının bugünkü biçimi (dosyalar[] yok)
  }, ek);
}

/* ============================================================ (1) MONOTON SÜRÜM */

test('gSurum: G3 biçimi ve SAYISAL kıyas (2.51.10 > 2.51.9); biçim dışı kıyaslanamaz', () => {
  assert.deepStrictEqual(kg.gSurumCoz('2.51.10'), { panel: 51, sayac: 10 });
  assert.strictEqual(kg.gSurumCoz('2.05.1'), null);
  assert.strictEqual(kg.gSurumCoz('a'.repeat(64)), null);
  assert.strictEqual(kg.gSurumKiyasla('2.51.10', '2.51.9'), 1);
  assert.strictEqual(kg.gSurumKiyasla('2.52.0', '2.51.99'), 1);
  assert.strictEqual(kg.gSurumKiyasla('2.51.9', '2.51.9'), 0);
  assert.strictEqual(kg.gSurumKiyasla('x', '2.51.9'), null);
  assert.strictEqual(kg.enBuyukGSurum([null, '1.0.0', '2.5.3', '2.5.10', 'e2e']), '2.5.10');
});

test('WINDOWS monoton: imzalı ESKİ manifest (tetik yalan söylüyor) → manifest düzeyinde RET, ağaç aynı', async () => {
  const { kok, set } = paketKur({ surum: '2.5.3' });
  const once = ozet(kok);
  const { r, istekler } = await kos(kok, set, tam('2.5.2', { surumTetik: '2.5.9' }));
  assert.strictEqual(r.sebep, 'manifest-reddedildi:surum-eski', JSON.stringify(r));
  assert.ok(istekler.includes('/set/9001/manifest.json'), 'tetik geçti, ret MANİFEST düzeyinde olmalı');
  assert.deepStrictEqual(ozet(kok), once, 'ağaca dokunulmamalı');
  assert.ok(!fs.existsSync(path.join(kok, kg.DAMGA_ADI)));
  assert.ok(!istekler.some((y) => y.startsWith('/arsiv/') || y.includes('/dosya/')), 'hiçbir dosya inmemeli');
});

test('WINDOWS monoton: kurulu sürüme EŞİT manifest de reddedilir (kesin büyük şartı)', async () => {
  const { kok, set } = paketKur({ surum: '2.5.3' });
  const { r } = await kos(kok, set, tam('2.5.3', { surumTetik: '2.5.4' }));
  assert.strictEqual(r.sebep, 'manifest-reddedildi:surum-eski');
});

test('WINDOWS monoton: son uygulanan G sürümü taban olur — 2.5.5 sonrası imzalı 2.5.4 geri oynatılamaz', async () => {
  const { kok, set } = paketKur({ surum: '2.5.3' });
  const a = await kos(kok, set, tam('2.5.5'));
  assert.strictEqual(a.r.durum, 'guncellendi', JSON.stringify(a.r));
  const sonra = ozet(kok);
  const eskiIndex = '<html>ESKI MENU (2.5.4)</html>';
  const b = await kos(kok, set, { surum: '2.5.4', surumTetik: '2.5.9', kabuk: { 'index.html': eskiIndex }, kitaplar: [] });
  assert.strictEqual(b.r.sebep, 'manifest-reddedildi:surum-eski', JSON.stringify(b.r));
  assert.strictEqual(b.r.kuruluSurum, '2.5.5');
  assert.deepStrictEqual(ozet(kok), sonra);
});

test('WINDOWS monoton: tetik kurulu sürümden büyük değilse manifest HİÇ indirilmez (1 istek)', async () => {
  const { kok, set } = paketKur({ surum: '2.5.3' });
  const { r, istekler } = await kos(kok, set, tam('2.5.1'));
  assert.strictEqual(r.durum, 'guncel');
  assert.strictEqual(r.sebep, 'uzak-surum-buyuk-degil');
  assert.deepStrictEqual(istekler, ['/set/9001/surum.json']);
});

test('WINDOWS: G3 biçiminde olmayan (sıralanamaz) manifest sürümü reddedilir', async () => {
  const { kok, set } = paketKur({ surum: '2.5.3' });
  const { r } = await kos(kok, set, tam('e'.repeat(64)));
  assert.strictEqual(r.sebep, 'manifest-reddedildi:surum-bicimi');
});

test('WINDOWS: paket sürümü G3 değilse (içerik-hash) ilk G kabul edilir, sonra damga taban olur', async () => {
  const { kok, set } = paketKur({ surum: '1.4821.77' });
  const a = await kos(kok, set, tam('2.5.1'));
  assert.strictEqual(a.r.durum, 'guncellendi', JSON.stringify(a.r));
  const b = await kos(kok, set, { surum: '2.5.0', surumTetik: '2.5.9', kabuk: { 'index.html': 'x' }, kitaplar: [] });
  assert.strictEqual(b.r.sebep, 'manifest-reddedildi:surum-eski');
});

test('WINDOWS: damga ESKİ pakete aitse (taban değişti) yok sayılır — paket sürümü taban olur', async () => {
  const { kok, set } = paketKur({ surum: '2.5.3' });
  fs.writeFileSync(path.join(kok, kg.DAMGA_ADI), JSON.stringify({ surum: '2.5.9', taban: 'f'.repeat(64) }));
  const { r } = await kos(kok, set, tam('2.5.4'));
  assert.strictEqual(r.durum, 'guncellendi', JSON.stringify(r));
  const d = JSON.parse(oku(kok, kg.DAMGA_ADI));
  assert.strictEqual(d.surum, '2.5.4');
  assert.match(d.taban, /^[0-9a-f]{64}$/);
});

/* ======================================================== (2) SET KİMLİĞİ / KANAL */

test('WINDOWS set kimliği: başka setin İMZALI manifesti (tetik doğru set) → RET, ağaç aynı', async () => {
  const { kok, set } = paketKur();
  const once = ozet(kok);
  const { r, istekler } = await kos(kok, set, tam('2.5.4', { manifestSet: '9002' }));
  assert.strictEqual(r.sebep, 'manifest-reddedildi:baska-set', JSON.stringify(r));
  assert.ok(istekler.includes('/set/9001/manifest.json'));
  assert.deepStrictEqual(ozet(kok), once);
});

test('WINDOWS set kimliği: manifestte setKimligi YOK → RET (eksik = eşit değil)', async () => {
  const { kok, set } = paketKur();
  const { r } = await kos(kok, set, tam('2.5.4', { manifestSet: null }));
  assert.strictEqual(r.sebep, 'manifest-reddedildi:baska-set');
});

test('WINDOWS kanal: kanal "G" değilse (ya da yoksa) RET', async () => {
  const { kok, set } = paketKur();
  assert.strictEqual((await kos(kok, set, tam('2.5.4', { kanal: 'K' }))).r.sebep, 'manifest-reddedildi:kanal-g-degil');
  assert.strictEqual((await kos(kok, set, tam('2.5.4', { kanal: null }))).r.sebep, 'manifest-reddedildi:kanal-g-degil');
});

test('surum.json başka sete aitse manifest indirilmez (ucuz ön ret; asıl ret manifestte)', async () => {
  const { kok, set } = paketKur();
  const { r, istekler } = await kos(kok, set, tam('2.5.4', {
    bozRotalar: (rot) => { rot['/set/9001/surum.json'] = JSON.stringify({ surum: '2.5.4', setKimligi: '9002' }); },
  }));
  assert.strictEqual(r.sebep, 'uzak-baska-set');
  assert.deepStrictEqual(istekler, ['/set/9001/surum.json']);
});

test('manifestKimligiDenetle saf: kabul ve her ret sebebi', () => {
  const m = (e) => Object.assign({ kanal: 'G', setKimligi: '9001', surum: '2.5.4' }, e);
  assert.strictEqual(kg.manifestKimligiDenetle(m(), '9001', '2.5.3'), '');
  assert.strictEqual(kg.manifestKimligiDenetle(m(), '9001', null), '');
  assert.strictEqual(kg.manifestKimligiDenetle(m({ kanal: 'K' }), '9001', null), 'kanal-g-degil');
  assert.strictEqual(kg.manifestKimligiDenetle(m({ setKimligi: '9002' }), '9001', null), 'baska-set');
  assert.strictEqual(kg.manifestKimligiDenetle(m({ surum: 'x' }), '9001', null), 'surum-bicimi');
  assert.strictEqual(kg.manifestKimligiDenetle(m(), '9001', '2.5.4'), 'surum-eski');
  assert.strictEqual(kg.manifestKimligiDenetle(null, '9001', null), 'manifest-gecersiz');
});

/* ============================================================== (3) YA HEP YA HİÇ */

test('WINDOWS ya hep ya hiç: bir motor bozuk servis ediliyor → index/kitap/çıkarma HİÇBİRİ uygulanmaz', async () => {
  const { kok, set } = paketKur();
  const once = ozet(kok);
  const { r } = await kos(kok, set, tam('2.5.4', {
    bozRotalar: (rot) => { rot[`/set/9001/dosya/book1/${MOTOR}`] = Buffer.from('/* BOZUK */'); },
  }));
  assert.strictEqual(r.durum, 'kismi');
  assert.match(r.sebep, /^kabuk-(boyut|sha256)-uyusmaz$/);
  assert.deepStrictEqual(ozet(kok), once, 'tek bayt bile değişmemeli (index, book2, book4)');
  assert.ok(!fs.existsSync(path.join(kok, kg.GECICI_DIZIN)), 'hazırlık alanı kalmamalı');
  assert.ok(!fs.existsSync(path.join(kok, kg.DAMGA_ADI)));
  assert.deepStrictEqual(r.eklenen, []);
  assert.strictEqual(r.kabukIndirilen, 0);
});

test('WINDOWS ya hep ya hiç: kitap arşivi bozuk → kabuk da yazılmaz', async () => {
  const { kok, set } = paketKur();
  const once = ozet(kok);
  const { r } = await kos(kok, set, tam('2.5.4', {
    bozRotalar: (rot) => { rot['/arsiv/book4.zip'] = Buffer.from('bozuk zip'); },
  }));
  assert.strictEqual(r.sebep, 'kitap-hazirlanamadi');
  assert.deepStrictEqual(ozet(kok), once);
});

/** Gerçek fs; `kural(op, a, b)` true dönerse o çağrı HATA fırlatır. */
function hataliFs(kural) {
  const g = kg.varsayilanFs();
  const sar = (op, f) => async (...a) => {
    if (kural(op, a[0], a[1])) { const e = new Error('ENJEKTE-' + op); e.code = 'EPERM'; throw e; }
    return f(...a);
  };
  return {
    readFile: sar('readFile', g.readFile), writeFile: sar('writeFile', g.writeFile),
    rename: sar('rename', g.rename), unlink: sar('unlink', g.unlink), mkdir: sar('mkdir', g.mkdir),
    stat: g.stat, readdir: g.readdir, rm: sar('rm', g.rm),
  };
}

test('WINDOWS ya hep ya hiç: uygulama ORTASINDA rename düşerse (index kilitli) yapılanlar geri alınır', async () => {
  const { kok, set } = paketKur();
  const once = ozet(kok);
  // Yeni index'i yerine koyan rename BİR KEZ düşer (geri almadaki rename serbest).
  let dustu = false;
  const fsm = hataliFs((op, a, b) => {
    if (dustu || op !== 'rename' || b !== path.join(kok, 'index.html')) return false;
    dustu = true;
    return true;
  });
  const { r } = await kos(kok, set, tam('2.5.4'), { fs: fsm });
  assert.ok(dustu, 'ön koşul: hata enjekte edildi');
  assert.strictEqual(r.sebep, 'uygulama-geri-alindi', JSON.stringify(r));
  assert.deepStrictEqual(ozet(kok), once, 'book2 geri gelmeli, book4 gitmeli, motor eski olmalı');
  assert.ok(!fs.existsSync(path.join(kok, kg.GECICI_DIZIN)));
  assert.ok(!fs.existsSync(path.join(kok, kg.DAMGA_ADI)));
});

test('WINDOWS ya hep ya hiç: damga (kesinleşme) yazılamazsa uygulama geri alınır', async () => {
  const { kok, set } = paketKur();
  const once = ozet(kok);
  const fsm = hataliFs((op, a, b) => op === 'rename' && b === path.join(kok, kg.DAMGA_ADI));
  const { r } = await kos(kok, set, tam('2.5.4'), { fs: fsm });
  assert.strictEqual(r.sebep, 'uygulama-geri-alindi');
  assert.deepStrictEqual(ozet(kok), once);
});

test('WINDOWS günce: süreç uygulama ORTASINDA çökerse sonraki açılış yarım işi GERİ SARAR', async () => {
  const { kok, set } = paketKur();
  const once = ozet(kok);
  // "Çökme": 2. uygulama rename'inden sonra fs tamamen ölür (geri alma da yapamaz).
  let uygulamaRename = 0;
  let olu = false;
  const fsm = hataliFs((op, a, b) => {
    if (olu) return true;
    if (op === 'rename' && typeof b === 'string' && !b.endsWith(kg.GECICI_UZANTI)
      && !String(a).endsWith(kg.GECICI_UZANTI) && !b.includes(path.sep + kg.GECICI_DIZIN + path.sep + 'hazir')) {
      uygulamaRename += 1;
      if (uygulamaRename > 2) { olu = true; return true; }
    }
    return false;
  });
  await kos(kok, set, tam('2.5.4'), { fs: fsm });
  assert.notDeepStrictEqual(ozet(kok), once, 'ön koşul: ağaç yarım kalmış olmalı');
  assert.ok(fs.existsSync(path.join(kok, kg.GECICI_DIZIN, kg.GUNCE_ADI)), 'ön koşul: günce duruyor');
  // Sonraki açılış: sunucu yok (surum 404) — toparlama yine de koşar.
  const s = await sunucu({});
  try {
    const r = await kg.guncellemeyiCalistir({ taban: s.taban, set, kok, gunluk: sessiz, zamanAsimi: 3000 });
    assert.strictEqual(r.artik >= 1, true);
  } finally { await s.kapat(); }
  assert.deepStrictEqual(ozet(kok), once, 'yarım uygulama geri sarılmalı');
  assert.ok(!fs.existsSync(path.join(kok, kg.GECICI_DIZIN)));
});

test('WINDOWS günce: damga yazıldıktan SONRA çöktüyse kesinleşmiştir — yalnız artık temizlenir', async () => {
  const { kok, set } = paketKur();
  const a = await kos(kok, set, tam('2.5.4'));
  assert.strictEqual(a.r.durum, 'guncellendi');
  const sonra = ozet(kok);
  // Kesinleşmiş ama temizlenmemiş hâl: günce + yedek dizini duruyor.
  const gk = path.join(kok, kg.GECICI_DIZIN);
  fs.mkdirSync(path.join(gk, 'yedek', 'y0'), { recursive: true });
  fs.writeFileSync(path.join(gk, 'yedek', 'y0', 'index.html'), 'eski kitap2');
  fs.writeFileSync(path.join(gk, kg.GUNCE_ADI), JSON.stringify({
    sema: 1, surum: '2.5.4', ilerleme: 0,
    adimlar: [{ tur: 'kitap-cikar', ad: 'book2', yeni: null, hedef: 'book2', yedek: 'yedek/y0' }],
  }));
  const n = await kg.yarimUygulamayiToparla(kg.varsayilanFs(), kok, sessiz);
  assert.strictEqual(n, 1);
  assert.deepStrictEqual(ozet(kok), sonra, 'kesinleşmiş durum GERİ ALINMAMALI');
  assert.ok(!fs.existsSync(gk));
});

test('WINDOWS günce: kök dışına işaret eden (kurcalanmış) günce adımı uygulanmaz', async () => {
  const { kok } = paketKur();
  const disari = tmp('disari');
  fs.writeFileSync(path.join(disari, 'kurban.txt'), 'dokunma');
  const gk = path.join(kok, kg.GECICI_DIZIN);
  fs.mkdirSync(gk, { recursive: true });
  fs.writeFileSync(path.join(gk, kg.GUNCE_ADI), JSON.stringify({
    sema: 1, surum: '2.9.9', ilerleme: 0,
    adimlar: [{ tur: 'kabuk', ad: 'x', yeni: '../../' + path.basename(disari) + '/kurban.txt', hedef: '../x', yedek: 'y' }],
  }));
  await kg.yarimUygulamayiToparla(kg.varsayilanFs(), kok, sessiz);
  assert.strictEqual(fs.readFileSync(path.join(disari, 'kurban.txt'), 'utf8'), 'dokunma');
});

test('WINDOWS sıra: önce kitaplar, sonra kabuk, EN SON index.html', async () => {
  const { kok, set } = paketKur();
  const { r } = await kos(kok, set, tam('2.5.4'));
  assert.strictEqual(r.durum, 'guncellendi', JSON.stringify(r));
  assert.deepStrictEqual(r.sira.map((x) => x.tur + ':' + x.ad),
    ['kitap-ekle:book4', 'kitap-cikar:book2', `kabuk:book1/${MOTOR}`, 'kabuk:index.html']);
  assert.strictEqual(oku(kok, 'index.html'), YENI_INDEX);
  assert.strictEqual(oku(kok, `book1/${MOTOR}`), YENI_MOTOR);
  assert.strictEqual(oku(kok, 'book4/index.html'), '<html>kitap4</html>');
  assert.ok(!fs.existsSync(path.join(kok, 'book2')));
  assert.ok(!fs.existsSync(path.join(kok, kg.GECICI_DIZIN)));
});

/* ================================================ (4) BİRİKİMLİ: YENİDEN İNDİRME YOK */

test('WINDOWS birikimli: aynı sha256\'lı ekle arşivi sonraki sürümde YENİDEN İNDİRİLMEZ', async () => {
  const { kok, set } = paketKur();
  const a = await kos(kok, set, tam('2.5.4'));
  assert.ok(a.istekler.includes('/arsiv/book4.zip'));
  const b = await kos(kok, set, tam('2.5.5', { kabuk: { 'index.html': '<html>MENU v3</html>', [`book1/${MOTOR}`]: YENI_MOTOR } }));
  assert.strictEqual(b.r.durum, 'guncellendi', JSON.stringify(b.r));
  assert.ok(!b.istekler.includes('/arsiv/book4.zip'), 'arşiv yeniden inmemeli: ' + b.istekler.join(','));
  assert.strictEqual(b.r.kitapZatenKurulu, 1);
  assert.strictEqual(oku(kok, 'index.html'), '<html>MENU v3</html>');
  assert.strictEqual(oku(kok, 'book4/index.html'), '<html>kitap4</html>');
  assert.deepStrictEqual(JSON.parse(oku(kok, kg.DAMGA_ADI)).kitaplar.book4.length, 64);
});

test('WINDOWS birikimli: defterde olsa da kitap dizini silinmişse yeniden kurulur', async () => {
  const { kok, set } = paketKur();
  await kos(kok, set, tam('2.5.4'));
  fs.rmSync(path.join(kok, 'book4'), { recursive: true, force: true });
  const b = await kos(kok, set, tam('2.5.5'));
  assert.ok(b.istekler.includes('/arsiv/book4.zip'));
  assert.strictEqual(oku(kok, 'book4/index.html'), '<html>kitap4</html>');
});

test('WINDOWS kural 8: kitabı tabanda olmayan bookN/… girdisi atlanır, boş dizin açılmaz', async () => {
  const { kok, set } = paketKur();
  const { r, istekler } = await kos(kok, set, {
    surum: '2.5.4',
    kabuk: { 'index.html': YENI_INDEX, [`book9/${MOTOR}`]: YENI_MOTOR, [`book2/${MOTOR}`]: YENI_MOTOR },
    kitaplar: [],
  });
  assert.strictEqual(r.durum, 'guncellendi', JSON.stringify(r));
  assert.strictEqual(r.kabukKitapsiz, 1);
  assert.ok(!fs.existsSync(path.join(kok, 'book9')), 'boş kitap dizini oluşmamalı');
  assert.ok(!istekler.includes(`/set/9001/dosya/book9/${MOTOR}`));
  assert.strictEqual(oku(kok, `book2/${MOTOR}`), YENI_MOTOR);
});

test('WINDOWS kural 8: aynı manifestte eklenen kitabın bookN/… girdisi hazırlanan kitaba yazılır', async () => {
  const { kok, set } = paketKur();
  const v3 = '/* motor v3 */';
  const { r } = await kos(kok, set, tam('2.5.4', { kabuk: { 'index.html': YENI_INDEX, [`book4/${MOTOR}`]: v3 } }));
  assert.strictEqual(r.durum, 'guncellendi', JSON.stringify(r));
  assert.strictEqual(oku(kok, `book4/${MOTOR}`), v3);
});

test('WINDOWS: kanalın durum yolunu hedefleyen imzalı kabuk girdisi bütün güncellemeyi reddeder', async () => {
  const { kok, set } = paketKur();
  const once = ozet(kok);
  const { r } = await kos(kok, set, { surum: '2.5.4', kabuk: { 'index.html': YENI_INDEX, [kg.DAMGA_ADI]: '{}' }, kitaplar: [] });
  assert.strictEqual(r.sebep, 'kabuk-durum-yolu');
  assert.deepStrictEqual(ozet(kok), once);
});

/* ======================================================= ÖRTÜ (mac + Pardus) — aynı kurallar */

async function ortuKos(kok, set, ortuKoku, secenek) {
  return kos(kok, set, secenek, { ortuKoku });
}
const ortuOku = (kok, ortuKoku, rel) => {
  const d = kg.ortuDurumuYukle({ kok, ortuKoku });
  const c = kg.ortuCoz(d, rel);
  if (!c) return ['taban', oku(kok, rel)];
  if (c.tur === 'yok') return ['yok'];
  return ['ortu', fs.readFileSync(c.yol, 'utf8')];
};

test('ÖRTÜ monoton: 2.5.5 örtüsü üstüne imzalı 2.5.4 (tetik yalan) → RET, etkin durum aynı', async () => {
  const { kok, set } = paketKur();
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  const a = await ortuKos(kok, set, ortuKoku, tam('2.5.5'));
  assert.strictEqual(a.r.durum, 'guncellendi', JSON.stringify(a.r));
  const etkin = fs.readFileSync(path.join(ortuKoku, kg.ORTU_ETKIN), 'utf8');
  const b = await ortuKos(kok, set, ortuKoku, { surum: '2.5.4', surumTetik: '2.5.9', kabuk: { 'index.html': 'ESKI' }, kitaplar: [] });
  assert.strictEqual(b.r.sebep, 'manifest-reddedildi:surum-eski', JSON.stringify(b.r));
  assert.strictEqual(fs.readFileSync(path.join(ortuKoku, kg.ORTU_ETKIN), 'utf8'), etkin);
  assert.deepStrictEqual(ortuOku(kok, ortuKoku, 'index.html'), ['ortu', YENI_INDEX]);
});

test('ÖRTÜ monoton: paket sürümüne eşit/küçük imzalı manifest ilk kurulumda da reddedilir', async () => {
  const { kok, set } = paketKur({ surum: '2.5.3' });
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  const { r } = await ortuKos(kok, set, ortuKoku, tam('2.5.3', { surumTetik: '2.5.8' }));
  assert.strictEqual(r.sebep, 'manifest-reddedildi:surum-eski');
  assert.ok(!fs.existsSync(ortuKoku), 'örtü dizini oluşmamalı');
});

test('ÖRTÜ set kimliği: başka setin imzalı manifesti → RET, örtü oluşmaz', async () => {
  const { kok, set } = paketKur();
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  const { r } = await ortuKos(kok, set, ortuKoku, tam('2.5.4', { manifestSet: '9002' }));
  assert.strictEqual(r.sebep, 'manifest-reddedildi:baska-set');
  assert.ok(!fs.existsSync(ortuKoku));
});

test('ÖRTÜ yükleme: etkin manifest başka sete aitse (elle konmuş) örtü yüklenmez', async () => {
  const { kok, set } = paketKur();
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  await ortuKos(kok, set, ortuKoku, tam('2.5.4'));
  // Aynı anahtarla imzalı ama 9002 kimlikli manifesti etkin durum yap (etkin.setKimligi 9001).
  const m = Buffer.from(JSON.stringify({ sema: 1, kanal: 'G', setKimligi: '9002', surum: '2.5.4', kabuk: [], kitaplar: [] }));
  const ad = kg.sha256(m) + '.json';
  fs.writeFileSync(path.join(ortuKoku, kg.ORTU_NESNE, ad), m);
  const e = JSON.parse(fs.readFileSync(path.join(ortuKoku, kg.ORTU_ETKIN), 'utf8'));
  Object.assign(e, { manifest: ad, imza: imzala(m), ortuYollari: [], eklenen: [], cikarilan: [], kitapListeleri: {} });
  fs.writeFileSync(path.join(ortuKoku, kg.ORTU_ETKIN), JSON.stringify(e));
  assert.strictEqual(kg.ortuDurumuYukle({ kok, ortuKoku }).sebep, 'manifest-kimligi');
});

test('ÖRTÜ ya hep ya hiç: bir motor bozuk → örtü OLUŞMAZ / eski örtü aynen kalır', async () => {
  const { kok, set } = paketKur();
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  const { r } = await ortuKos(kok, set, ortuKoku, tam('2.5.4', {
    bozRotalar: (rot) => { rot[`/set/9001/dosya/book1/${MOTOR}`] = Buffer.from('/* BOZUK */'); },
  }));
  assert.strictEqual(r.durum, 'kismi');
  assert.ok(!fs.existsSync(path.join(ortuKoku, kg.ORTU_ETKIN)));
});

test('ÖRTÜ listesiz ekle (G yayın biçimi): liste ARŞİVDEN türetilir, arşiv saklanır, kitap sunulur', async () => {
  const { kok, set } = paketKur();
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  const { r } = await ortuKos(kok, set, ortuKoku, tam('2.5.4'));
  assert.strictEqual(r.durum, 'guncellendi', JSON.stringify(r));
  const d = kg.ortuDurumuYukle({ kok, ortuKoku });
  assert.strictEqual(d.gecerli, true, d.sebep);
  assert.deepStrictEqual(ortuOku(kok, ortuKoku, 'book4/index.html'), ['ortu', '<html>kitap4</html>']);
  assert.deepStrictEqual(ortuOku(kok, ortuKoku, 'book4/listede-yok.js'), ['yok']);
  assert.deepStrictEqual(ortuOku(kok, ortuKoku, 'book2/index.html'), ['yok']);
  const etkin = JSON.parse(fs.readFileSync(path.join(ortuKoku, kg.ORTU_ETKIN), 'utf8'));
  assert.ok(fs.existsSync(path.join(ortuKoku, kg.ORTU_NESNE, etkin.kitapListeleri.book4.arsiv)), 'arşiv nesnesi saklanmalı');
});

test('ÖRTÜ birikimli: aynı sha256\'lı arşiv sonraki sürümde YENİDEN İNDİRİLMEZ', async () => {
  const { kok, set } = paketKur();
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  await ortuKos(kok, set, ortuKoku, tam('2.5.4'));
  const b = await ortuKos(kok, set, ortuKoku, tam('2.5.5', { kabuk: { 'index.html': 'MENU v3' } }));
  assert.strictEqual(b.r.durum, 'guncellendi', JSON.stringify(b.r));
  assert.ok(!b.istekler.includes('/arsiv/book4.zip'), b.istekler.join(','));
  assert.strictEqual(b.r.kitapZatenKurulu, 1);
  assert.deepStrictEqual(ortuOku(kok, ortuKoku, 'book4/index.html'), ['ortu', '<html>kitap4</html>']);
  assert.deepStrictEqual(ortuOku(kok, ortuKoku, 'index.html'), ['ortu', 'MENU v3']);
});

test('ÖRTÜ türetilmiş liste KURCALANIRSA kitap sunulmaz (liste imzalı arşivden yeniden türetilir)', async () => {
  const { kok, set } = paketKur();
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  await ortuKos(kok, set, ortuKoku, tam('2.5.4'));
  const ey = path.join(ortuKoku, kg.ORTU_ETKIN);
  const e = JSON.parse(fs.readFileSync(ey, 'utf8'));
  // Saldırgan: listedeki index.html'i kendi yazdığı (içerik-adresli, özeti doğru) nesneye yönlendirir.
  const kotu = Buffer.from('<script>kotu()</script>');
  const ks = kg.sha256(kotu);
  fs.writeFileSync(path.join(ortuKoku, kg.ORTU_NESNE, ks + '.html'), kotu);
  const liste = e.kitapListeleri.book4.dosyalar.map((x) => (x.yol === 'index.html' ? { ...x, sha256: ks, boyut: kotu.length } : x));
  e.kitapListeleri.book4.dosyalar = liste;
  fs.writeFileSync(ey, JSON.stringify(e));
  const d = kg.ortuDurumuYukle({ kok, ortuKoku });
  assert.strictEqual(d.gecerli, true, 'kabuk örtüsü yine yüklenir');
  assert.deepStrictEqual(kg.ortuCoz(d, 'book4/index.html'), { tur: 'yok' });
  assert.deepStrictEqual(kg.ortuCoz(d, `book4/${MOTOR}`), { tur: 'yok' }, 'kitabın TAMAMI sunulmaz');
});

test('ÖRTÜ türetilmiş: arşiv nesnesi değiştirilirse kitap sunulmaz; çıkarılmış dosya bozulursa yalnız o', async () => {
  const { kok, set } = paketKur();
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  await ortuKos(kok, set, ortuKoku, tam('2.5.4'));
  const e = JSON.parse(fs.readFileSync(path.join(ortuKoku, kg.ORTU_ETKIN), 'utf8'));
  const nk = path.join(ortuKoku, kg.ORTU_NESNE);
  // (a) çıkarılmış tek nesne bozulur → yalnız o dosya 'yok'
  const giris = e.kitapListeleri.book4.dosyalar.find((x) => x.yol === 'index.html');
  const nesne = path.join(nk, kg.nesneAdi(giris.sha256, 'book4/index.html'));
  fs.writeFileSync(nesne, '<html>kitap4</html>'.replace('4', 'X'));
  let d = kg.ortuDurumuYukle({ kok, ortuKoku });
  assert.deepStrictEqual(kg.ortuCoz(d, 'book4/index.html'), { tur: 'yok' });
  assert.strictEqual(kg.ortuCoz(d, `book4/${MOTOR}`).tur, 'ortu');
  // (b) arşiv nesnesi değişir → kitabın tamamı 'yok'
  fs.appendFileSync(path.join(nk, e.kitapListeleri.book4.arsiv), 'X');
  d = kg.ortuDurumuYukle({ kok, ortuKoku });
  assert.deepStrictEqual(kg.ortuCoz(d, `book4/${MOTOR}`), { tur: 'yok' });
});

test('ÖRTÜ: eklenen kitabın imzalı kabuk girdisi (motor) arşivdekini EZER', async () => {
  const { kok, set } = paketKur();
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  const v3 = '/* motor v3 */';
  const { r } = await ortuKos(kok, set, ortuKoku, tam('2.5.4', { kabuk: { 'index.html': YENI_INDEX, [`book4/${MOTOR}`]: v3 } }));
  assert.strictEqual(r.durum, 'guncellendi', JSON.stringify(r));
  assert.deepStrictEqual(ortuOku(kok, ortuKoku, `book4/${MOTOR}`), ['ortu', v3]);
  assert.deepStrictEqual(ortuOku(kok, ortuKoku, 'book4/index.html'), ['ortu', '<html>kitap4</html>']);
});

test('ÖRTÜ kural 8: tabanda olmayan kitabın bookN/… girdisi atlanır (örtüde hayalet kitap yok)', async () => {
  const { kok, set } = paketKur();
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  const { r } = await ortuKos(kok, set, ortuKoku, { surum: '2.5.4', kabuk: { 'index.html': YENI_INDEX, [`book9/${MOTOR}`]: YENI_MOTOR }, kitaplar: [] });
  assert.strictEqual(r.durum, 'guncellendi', JSON.stringify(r));
  assert.strictEqual(r.kabukKitapsiz, 1);
  assert.strictEqual(ortuOku(kok, ortuKoku, `book9/${MOTOR}`)[0], 'taban');
  assert.strictEqual(ortuOku(kok, ortuKoku, `book9/${MOTOR}`)[1], null);
});

test('ortuGorunumu: etkin görünüm = paket + örtü, gizlenenler yok', async () => {
  const { kok, set } = paketKur();
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  await ortuKos(kok, set, ortuKoku, tam('2.5.4'));
  const g = kg.ortuGorunumu(kg.ortuDurumuYukle({ kok, ortuKoku }), kok);
  const icerik = (y) => fs.readFileSync(g.get(y), 'utf8');
  assert.strictEqual(icerik('index.html'), YENI_INDEX);
  assert.strictEqual(icerik(`book1/${MOTOR}`), YENI_MOTOR);
  assert.strictEqual(icerik('book4/index.html'), '<html>kitap4</html>');
  assert.ok(!g.has('book2/index.html'));
  assert.strictEqual(icerik('book1/index.html'), '<html>kitap1</html>');
});

/* ============================================ (4) PAKETİN G SÜRÜMÜ (claim `surum`, 2026-09-26) */
// package.json sürümü G3 değilken (Pardus/Windows paketleri '1.0.0' ile üretilir) taban yoktu:
// paketin içerdiği sürümün imzalı manifesti ilk açılışta yeniden oynatılabiliyordu. Claim'in
// `surum`u empp-set.json'a yazılır ve monoton tabana girer.
function setSurumlu(kok, set, surum) {
  const s = Object.assign({}, set, { surum });
  fs.writeFileSync(path.join(kok, 'empp-set.json'), JSON.stringify(s));
  return s;
}

test('WINDOWS set sürümü: package.json G3 değil, empp-set.json surum=2.5.3 → eşit/eski imzalı manifest RET', async () => {
  const { kok, set } = paketKur({ surum: '1.0.0' });
  const s = setSurumlu(kok, set, '2.5.3');
  const once = ozet(kok);
  const a = await kos(kok, s, tam('2.5.3', { surumTetik: '2.5.8' }));
  assert.strictEqual(a.r.sebep, 'manifest-reddedildi:surum-eski', JSON.stringify(a.r));
  assert.strictEqual(a.r.kuruluSurum, '2.5.3');
  assert.deepStrictEqual(ozet(kok), once, 'ağaç aynı kalmalı');
  const b = await kos(kok, s, tam('2.5.4'));
  assert.strictEqual(b.r.durum, 'guncellendi', JSON.stringify(b.r));
});

test('ÖRTÜ set sürümü: empp-set.json surum tabanı ilk kurulumda da geçerli — eski manifest örtü kurmaz', async () => {
  const { kok, set } = paketKur({ surum: '1.0.0' });
  const s = setSurumlu(kok, set, '2.5.3');
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  const { r } = await ortuKos(kok, s, ortuKoku, tam('2.5.2', { surumTetik: '2.5.8' }));
  assert.strictEqual(r.sebep, 'manifest-reddedildi:surum-eski');
  assert.ok(!fs.existsSync(ortuKoku), 'örtü dizini oluşmamalı');
});

test('set sürümü G3 değilse (bozuk/elle) yok sayılır — package.json/damga tabanı geçerli kalır', async () => {
  const { kok, set } = paketKur({ surum: '1.0.0' });
  const s = setSurumlu(kok, set, '9.9.9.9');
  const { r } = await kos(kok, s, tam('2.5.1'));
  assert.strictEqual(r.durum, 'guncellendi', JSON.stringify(r));
});
