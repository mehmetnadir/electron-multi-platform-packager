'use strict';
// G — Android istemcisi (politika katmanı): iki kademe, ed25519 imza (WebCrypto → tweetnacl),
// kapsam (set-kabuk tek kaynak + bookN motoru), Android bekçisi, atomik plan. Gerçek anahtarla.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const G = require('./empp-g-istemci.js');
const kabuk = require('../../packaging/set-kabuk');
const nacl = require('./vendor/tweetnacl-1.0.3/nacl.min.js');

const ANAHTAR = crypto.generateKeyPairSync('ed25519');
const ACIK = ANAHTAR.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const BASKA = crypto.generateKeyPairSync('ed25519');
const TABAN = 'https://g.test/guncelleme';
const KOK = `${TABAN}/set/73768/android`;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const imzala = (b, k = ANAHTAR.privateKey) => crypto.sign(null, Buffer.from(b), k).toString('base64');
const MOTOR = '43e23fce2b7009474555a77.js';

const INDEX = Buffer.from('<html><head><script src="empp-android-shim.js"></script></head><body>YENİ MENÜ</body></html>');
const AYAR = Buffer.from('{"bookCount":3}');
const MOTOR_YENI = Buffer.from('/*motor 2026.9.12*/');

function manifest(ek = {}) {
  return {
    kanal: 'G',
    setKimligi: '73768',
    surum: '2.51.2',
    kabuk: [
      { yol: 'index.html', sha256: sha(INDEX), boyut: INDEX.length },
      { yol: 'config/settings.json', sha256: sha(AYAR), boyut: AYAR.length },
      { yol: `book1/${MOTOR}`, sha256: sha(MOTOR_YENI), boyut: MOTOR_YENI.length },
    ],
    kitaplar: [
      { dizin: 'book7', durum: 'ekle', kaynak: 'https://cdn.g.test/book7.zip', sha256: 'a'.repeat(64), boyut: 1234, androidKaynak: 'https://cdn.g.test/book7.zip', androidSha256: 'a'.repeat(64), androidBoyut: 1234 },
      { dizin: 'book3', durum: 'cikar' },
    ],
    ...ek,
  };
}

/** Sahte EmppG köprüsü + uç. Her çağrıyı kaydeder. */
function kur({ man = manifest(), sig, surum = '2.51.2', surumSet, yerelSurum = null, paket, ozet = {}, set, kitap,
  kitapHata, dosyalar } = {}) {
  const govde = Buffer.from(JSON.stringify(man));
  const uc = new Map();
  const koy = (a, b, d = 200) => uc.set(a, { d, b: b == null ? null : Buffer.from(b) });
  if (surum !== null) {
    koy(`${KOK}/surum.json`, JSON.stringify({ surum, uretim: '2026-09-26T00:00:00Z', setKimligi: surumSet }));
  }
  koy(`${KOK}/manifest.json`, govde);
  if (sig !== null) koy(`${KOK}/manifest.json.sig`, sig === undefined ? imzala(govde) : sig);
  const icerik = dosyalar || { 'index.html': INDEX, 'config/settings.json': AYAR, [`book1/${MOTOR}`]: MOTOR_YENI };
  for (const [y, b] of Object.entries(icerik)) koy(G.dosyaAdresi(KOK, y), b);
  const kayit = { getir: [], yaz: [], kitapKur: [], uygula: [], ozetler: [], sira: [] };
  const yerel = {
    yapilandirma: async () => ({ metin: JSON.stringify(set || {
      setKimligi: '73768', taban: TABAN, imza: { alg: 'ed25519', acikAnahtar: ACIK },
    }), paket: paket === undefined ? undefined : JSON.stringify({ surum: paket }) }),
    durum: async () => ({ surum: yerelSurum }),
    getir: async ({ adres, tavan }) => {
      kayit.getir.push(adres);
      const v = uc.get(adres);
      if (!v) return { durum: 404 };
      if (tavan && v.b && v.b.length > tavan) throw new Error('govde-tavani');
      return v.d === 200 ? { durum: 200, b64: v.b.toString('base64') } : { durum: v.d };
    },
    ozetler: async ({ yollar }) => { kayit.ozetler.push(yollar); const o = {}; for (const y of yollar) o[y] = ozet[y] || null; return { ozetler: o }; },
    yaz: async (a) => {
      if (sha(Buffer.from(a.b64, 'base64')) !== a.sha256) throw new Error('sha256-uyusmaz');
      kayit.yaz.push(a.sha256);
      kayit.sira.push('yaz');
      return { tamam: true };
    },
    kitapKur: async (a) => {
      kayit.kitapKur.push(a);
      kayit.sira.push('kitapKur');
      if (kitapHata === a.dizin) throw new Error('baglanti-koptu');
      return kitap || { klasor: `${a.dizin}-${a.sha256.slice(0, 16)}`, dosyaSayisi: 4, indexShimli: true, shimVar: true, manifestVar: true };
    },
    uygula: async (p) => { kayit.uygula.push(p); kayit.sira.push('uygula'); return { surum: p.surum }; },
  };
  return { yerel, kayit, govde };
}

const ortam = (yerel, ek = {}) => ({ yerel, kabuk, subtle: crypto.webcrypto.subtle, naclYukle: async () => nacl, ...ek });
const destekYok = { importKey: async () => { const e = new Error('Unrecognized name'); e.name = 'NotSupportedError'; throw e; } };

test('uç: <taban>/set/<kimlik>/android — Windows manifesti Android\'e uygulanmaz', () => {
  assert.strictEqual(G.kimlikKoku('https://x/guncelleme/', '11811'), 'https://x/guncelleme/set/11811/android');
  assert.strictEqual(G.dosyaAdresi('https://k', 'images/book 1.png'), 'https://k/dosya/images/book%201.png');
});

test('manifest YOK (404): hiçbir şey olmaz — manifest istenmez, yazılmaz, uygulanmaz', async () => {
  const { yerel, kayit } = kur({ surum: null });
  const r = await G.guncellemeyiCalistir(ortam(yerel));
  assert.strictEqual(r.durum, 'atlandi');
  assert.strictEqual(r.sebep, 'surum-alinamadi:durum-404');
  assert.deepStrictEqual(kayit.getir, [`${KOK}/surum.json`]);
  assert.strictEqual(kayit.yaz.length + kayit.kitapKur.length + kayit.uygula.length, 0);
});

test('sürüm aynı: manifest indirilmez', async () => {
  const { yerel, kayit } = kur({ yerelSurum: '2.51.2' });
  const r = await G.guncellemeyiCalistir(ortam(yerel));
  assert.strictEqual(r.durum, 'guncel');
  assert.strictEqual(kayit.getir.length, 1);
});

test('İMZALI güncelleme uygulanır: index + ayar + book1 motoru + book7 eklenir + book3 çıkar, TEK atomik uygula', async () => {
  const { yerel, kayit } = kur();
  const r = await G.guncellemeyiCalistir(ortam(yerel));
  assert.strictEqual(r.durum, 'guncellendi', JSON.stringify(r));
  assert.strictEqual(r.imzaYolu, 'webcrypto');
  assert.strictEqual(r.kabukIndirilen, 3);
  assert.deepStrictEqual(r.eklenen, ['book7']);
  assert.deepStrictEqual(r.cikarilan, ['book3']);
  assert.strictEqual(kayit.uygula.length, 1);
  const p = kayit.uygula[0];
  assert.strictEqual(p.surum, '2.51.2');
  assert.deepStrictEqual(p.dosyalar.map((d) => d.yol).sort(), ['book1/' + MOTOR, 'config/settings.json', 'index.html']);
  assert.deepStrictEqual(p.kitaplar, [{ dizin: 'book7', klasor: 'book7-aaaaaaaaaaaaaaaa', sha256: 'a'.repeat(64) }]);
  assert.deepStrictEqual(p.cikarilan, ['book3']);
  assert.deepStrictEqual(kayit.kitapKur[0], { dizin: 'book7', adres: 'https://cdn.g.test/book7.zip', sha256: 'a'.repeat(64), boyut: 1234 });
});

test('BOZUK imza reddedilir: tek bit — hiçbir şey yazılmaz/indirilmez/uygulanmaz', async () => {
  const govde = Buffer.from(JSON.stringify(manifest()));
  const s = Buffer.from(imzala(govde), 'base64'); s[10] ^= 1;
  const { yerel, kayit } = kur({ sig: s.toString('base64') });
  const r = await G.guncellemeyiCalistir(ortam(yerel));
  assert.strictEqual(r.durum, 'red');
  assert.strictEqual(r.sebep, 'manifest-imzasi-gecersiz:imza-tutmadi');
  assert.strictEqual(kayit.yaz.length + kayit.kitapKur.length + kayit.uygula.length + kayit.ozetler.length, 0);
});

test('başka anahtarla imza / imzasız / imzadan sonra değişen manifest → RET', async () => {
  const govde = Buffer.from(JSON.stringify(manifest()));
  for (const [ad, sig, bek] of [
    ['başka anahtar', imzala(govde, BASKA.privateKey), 'manifest-imzasi-gecersiz:imza-tutmadi'],
    ['imzasız', null, 'manifest-imzasiz'],
    ['çöp imza', 'bu-imza-degil', 'manifest-imzasi-gecersiz:imza-bicimi'],
  ]) {
    const { yerel, kayit } = kur({ sig });
    const r = await G.guncellemeyiCalistir(ortam(yerel));
    assert.strictEqual(r.sebep, bek, ad);
    assert.strictEqual(kayit.uygula.length, 0, ad);
  }
  const k = kur({ sig: imzala(Buffer.from(JSON.stringify(manifest({ surum: 'eski' })))) });
  assert.strictEqual((await G.guncellemeyiCalistir(ortam(k.yerel))).durum, 'red', 'imzadan sonra değişen gövde');
});

test('WebCrypto Ed25519 YOK → gömülü tweetnacl doğrular (geçerli kabul, bozuk RET)', async () => {
  const a = kur();
  const r1 = await G.guncellemeyiCalistir(ortam(a.yerel, { subtle: destekYok }));
  assert.strictEqual(r1.durum, 'guncellendi');
  assert.strictEqual(r1.imzaYolu, 'tweetnacl');
  const govde = Buffer.from(JSON.stringify(manifest()));
  const s = Buffer.from(imzala(govde), 'base64'); s[63] ^= 0x80;
  const b = kur({ sig: s.toString('base64') });
  const r2 = await G.guncellemeyiCalistir(ortam(b.yerel, { subtle: destekYok }));
  assert.strictEqual(r2.sebep, 'manifest-imzasi-gecersiz:imza-tutmadi');
  assert.strictEqual(r2.imzaYolu, 'tweetnacl');
  assert.strictEqual(b.kayit.uygula.length, 0);
});

test('doğrulayıcı yoksa KAPALI kalır (fail-closed): WebCrypto desteksiz + nacl yüklenemedi', async () => {
  const { yerel, kayit } = kur();
  const r = await G.guncellemeyiCalistir(ortam(yerel, { subtle: destekYok, naclYukle: async () => { throw new Error('404'); } }));
  assert.strictEqual(r.durum, 'red');
  assert.strictEqual(r.sebep, 'manifest-imzasi-gecersiz:dogrulayici-yuklenemedi');
  assert.strictEqual(kayit.uygula.length, 0);
});

test('WebCrypto false dediyse tweetnacl\'a DÜŞÜLMEZ (kesin karar)', async () => {
  let naclCagrildi = false;
  const govde = Buffer.from(JSON.stringify(manifest()));
  const s = Buffer.from(imzala(govde), 'base64'); s[0] ^= 1;
  const { yerel } = kur({ sig: s.toString('base64') });
  const r = await G.guncellemeyiCalistir(ortam(yerel, { naclYukle: async () => { naclCagrildi = true; return nacl; } }));
  assert.strictEqual(r.imzaYolu, 'webcrypto');
  assert.strictEqual(naclCagrildi, false);
});

test('kapsam: kitap içi / classlibraries / assets / etkinlik motoru kopyası / kaçış → TÜM güncelleme RET', async () => {
  for (const yol of ['book3/app.js', 'classlibraries/ImWin32.dll', 'assets/1/x.png', `book1/assets/9/etk/${MOTOR}`,
    '../x', './index.html', 'node_modules/a.js', '_eski/index.html', 'fonts/a.ttf', 'book1/empp-android-shim.js']) {
    const m = manifest();
    m.kabuk.push({ yol, sha256: sha(Buffer.from(yol)), boyut: yol.length });
    const govde = Buffer.from(JSON.stringify(m));
    const { yerel, kayit } = kur({ man: m, sig: imzala(govde) });
    const r = await G.guncellemeyiCalistir(ortam(yerel));
    assert.strictEqual(r.durum, 'red', yol);
    assert.match(r.sebep, /^kapsam-disi:/, yol);
    assert.strictEqual(kayit.yaz.length + kayit.uygula.length, 0, yol);
  }
});

test('kapsam sınıfı: menü kabuğu set-kabuk.js\'ten (tek kaynak), motor yalnız kitap ana klasöründe', () => {
  const s = (y) => G.kapsamSinifi(y, kabuk);
  assert.strictEqual(s('index.html'), 'kapsam');
  assert.strictEqual(s('config/settings.json'), 'kapsam');
  assert.strictEqual(s('images/book4.png'), 'kapsam');
  assert.strictEqual(s(`book12/${MOTOR}`), 'kapsam');
  assert.strictEqual(s(MOTOR), 'kapsam', 'tek kitap paketinde kitabın ana klasörü köktür');
  assert.strictEqual(s('empp-android-shim.js'), 'platform');
  assert.strictEqual(s('empp-g-istemci.js'), 'platform');
  assert.strictEqual(s('empp-set.json'), 'platform', 'gömülü anahtarı taşıyan envanter G ile ASLA değişmez');
  assert.strictEqual(s(`book1/js/${MOTOR}`), 'disi');
  assert.strictEqual(s('book1/index.html'), 'disi');
});

test('platform dosyaları (empp-*) sessizce atlanır, güncelleme sürer', async () => {
  const m = manifest();
  m.kabuk.push({ yol: 'empp-android-shim.js', sha256: 'b'.repeat(64), boyut: 5 });
  m.kabuk.push({ yol: 'empp-manifest.json', sha256: 'c'.repeat(64), boyut: 5 });
  const { yerel, kayit } = kur({ man: m, sig: imzala(Buffer.from(JSON.stringify(m))) });
  const r = await G.guncellemeyiCalistir(ortam(yerel));
  assert.strictEqual(r.durum, 'guncellendi');
  assert.strictEqual(r.platformAtlanan, 2);
  assert.ok(!kayit.uygula[0].dosyalar.some((d) => d.yol.startsWith('empp-')));
});

test('Android bekçisi: shim\'siz yeni index.html → RET (G paketten kopmaz)', async () => {
  const cip = Buffer.from('<html><head></head><body>WINDOWS MENÜSÜ</body></html>');
  const m = manifest();
  m.kabuk[0] = { yol: 'index.html', sha256: sha(cip), boyut: cip.length };
  const { yerel, kayit } = kur({ man: m, sig: imzala(Buffer.from(JSON.stringify(m))),
    dosyalar: { 'index.html': cip, 'config/settings.json': AYAR, [`book1/${MOTOR}`]: MOTOR_YENI } });
  const r = await G.guncellemeyiCalistir(ortam(yerel));
  assert.strictEqual(r.sebep, 'index-android-shim-yok');
  assert.strictEqual(kayit.uygula.length, 0);
});

test('Android bekçisi: Android\'e hazırlanmamış kitap arşivi → RET', async () => {
  const { yerel, kayit } = kur({ kitap: { klasor: 'book7-x', indexShimli: false, shimVar: true, manifestVar: true } });
  const r = await G.guncellemeyiCalistir(ortam(yerel));
  assert.strictEqual(r.sebep, 'kitap-android-hazir-degil:book7');
  assert.strictEqual(kayit.uygula.length, 0);
});

test('değişmeyen kabuk indirilmez; hiçbir şey değişmediyse yalnız sürüm damgalanır', async () => {
  const m = manifest({ kitaplar: [] });
  const ozet = { 'index.html': sha(INDEX), 'config/settings.json': sha(AYAR), [`book1/${MOTOR}`]: sha(MOTOR_YENI) };
  const { yerel, kayit } = kur({ man: m, sig: imzala(Buffer.from(JSON.stringify(m))), ozet });
  const r = await G.guncellemeyiCalistir(ortam(yerel));
  assert.strictEqual(r.durum, 'guncel');
  assert.strictEqual(r.kabukAyni, 3);
  assert.strictEqual(kayit.yaz.length, 0);
  assert.ok(!kayit.getir.some((a) => a.includes('/dosya/')));
  assert.deepStrictEqual(kayit.uygula[0], { surum: '2.51.2', dosyalar: [], kitaplar: [], cikarilan: [] });
});

test('boyut uyuşmazlığı / sha uyuşmazlığı (yerel taraf) → RET, uygulanmaz', async () => {
  const m = manifest();
  m.kabuk[1] = { yol: 'config/settings.json', sha256: sha(AYAR), boyut: AYAR.length + 1 };
  const a = kur({ man: m, sig: imzala(Buffer.from(JSON.stringify(m))) });
  assert.strictEqual((await G.guncellemeyiCalistir(ortam(a.yerel))).sebep, 'boyut-uyusmaz:config/settings.json');
  const m2 = manifest();
  m2.kabuk[1] = { yol: 'config/settings.json', sha256: 'd'.repeat(64), boyut: AYAR.length };
  const b = kur({ man: m2, sig: imzala(Buffer.from(JSON.stringify(m2))) });
  const r = await G.guncellemeyiCalistir(ortam(b.yerel));
  assert.match(r.sebep, /^yazilamadi:config\/settings\.json:sha256-uyusmaz/);
  assert.strictEqual(b.kayit.uygula.length, 0);
});

test('plan tutarlılığı: yinelenen yol, çıkarılan kitabın motoru, bozuk üyelik → RET', () => {
  const r = (m) => G.planKur(m, kabuk).red;
  const m1 = manifest(); m1.kabuk.push({ ...m1.kabuk[0] });
  assert.strictEqual(r(m1), 'kabuk-yinelenen:index.html');
  const m2 = manifest(); m2.kabuk.push({ yol: `book3/${MOTOR}`, sha256: 'e'.repeat(64), boyut: 1 });
  assert.strictEqual(r(m2), `cikarilan-kitabin-motoru:book3/${MOTOR}`);
  assert.strictEqual(r(manifest({ kitaplar: [{ dizin: 'book7', durum: 'ekle', androidKaynak: 'http://x/y.zip', androidSha256: 'a'.repeat(64), androidBoyut: 1 }] })),
    'uyelik-kaynak-https-degil:book7');
  assert.strictEqual(r(manifest({ kitaplar: [{ dizin: '../book7', durum: 'cikar' }] })), 'uyelik-dizini-gecersiz');
  assert.strictEqual(r(manifest({ kitaplar: [{ dizin: 'book2', durum: 'cikar' }, { dizin: 'book2', durum: 'cikar' }] })), 'uyelik-yinelenen:book2');
  assert.strictEqual(r({ surum: 's', kabuk: [{ yol: 'index.html', sha256: 'x', boyut: 1 }] }), 'kabuk-girdisi-bozuk:index.html');
});

test('yapılandırma: kimlik yok / http taban / anahtar yok → KAPALI, hiç istek yok', async () => {
  for (const [set, bek] of [
    [{ setKimligi: null, taban: TABAN, imza: { alg: 'ed25519', acikAnahtar: ACIK }, sebep: 'x' }, /^set-kimligi-yok/],
    [{ setKimligi: '1', taban: 'http://g.test', imza: { alg: 'ed25519', acikAnahtar: ACIK } }, /^taban-https-degil$/],
    [{ setKimligi: '1', taban: TABAN }, /^imza-anahtari-yok$/],
    [{ setKimligi: '1', taban: TABAN, imza: { alg: 'ed25519', acikAnahtar: 'AAAA' } }, /^imza-anahtari-yok$/],
    [{ setKimligi: '../1', taban: TABAN, imza: { alg: 'ed25519', acikAnahtar: ACIK } }, /^set-kimligi-gecersiz$/],
  ]) {
    const { yerel, kayit } = kur({ set });
    const r = await G.guncellemeyiCalistir(ortam(yerel));
    assert.strictEqual(r.durum, 'kapali');
    assert.match(r.sebep, bek);
    assert.strictEqual(kayit.getir.length, 0);
  }
});

test('hiç atmaz: köprü eşzamanlı istisna fırlatsa bile rapor döner', async () => {
  const yerel = { yapilandirma: () => { throw new Error('patladı'); } };
  const r = await G.guncellemeyiCalistir({ yerel, kabuk });
  assert.strictEqual(r.durum, 'atlandi');
  assert.match(r.hata, /patladı/);
  const r2 = await G.guncellemeyiCalistir({});
  assert.strictEqual(r2.durum, 'kapali');
});

test('WebCrypto Ed25519 ölçümü: destek var/yok ayrımı', async () => {
  assert.deepStrictEqual(await G.webcryptoOlc(crypto.webcrypto.subtle, ACIK), { destek: true, sebep: '' });
  const y = await G.webcryptoOlc(destekYok, ACIK);
  assert.strictEqual(y.destek, false);
  assert.strictEqual(y.sebep, 'NotSupportedError');
  assert.strictEqual((await G.webcryptoOlc(undefined, ACIK)).sebep, 'subtle-yok');
});

test('androidSayfasiMi: yalnız gerçek script etiketi sayılır', () => {
  assert.ok(G.androidSayfasiMi('<head><script src="empp-android-shim.js"></script>'));
  assert.ok(G.androidSayfasiMi("<head><script defer src='./empp-android-shim.js'></script>"));
  assert.ok(!G.androidSayfasiMi('<!-- empp-android-shim.js --><head></head>'));
  assert.ok(!G.androidSayfasiMi('<head></head>'));
});

/* ------------------------------------------------------------------------------------------------
 * ÜÇ GÜVENLİK KURALI (Electron e07bc37 ile aynı): monoton sürüm · set kimliği · ya hep ya hiç.
 * ---------------------------------------------------------------------------------------------- */

const imzali = (m) => ({ man: m, sig: imzala(Buffer.from(JSON.stringify(m))) });
const dokunulmadi = (kayit) => kayit.yaz.length + kayit.kitapKur.length + kayit.uygula.length + kayit.ozetler.length;

test('G3 sürüm yardımcıları: sayısal kıyas, biçim dışı kıyaslanmaz, en büyük, paket dosyası', () => {
  assert.strictEqual(G.gSurumKiyasla('2.51.10', '2.51.9'), 1, 'sözlük sırası değil sayısal');
  assert.strictEqual(G.gSurumKiyasla('2.51.4', '2.52.0'), -1);
  assert.strictEqual(G.gSurumKiyasla('2.51.4', '2.51.4'), 0);
  assert.strictEqual(G.gSurumKiyasla('2.51.4', 'a1b2c3'), null);
  for (const kotu of ['1.51.4', '2.051.4', '2.51', '2.51.4.1', ' ', 'v2.51.4', '2.1234567890.1']) {
    assert.strictEqual(G.gSurumCoz(kotu), null, kotu);
  }
  assert.strictEqual(G.enBuyukGSurum([null, 'e3b0c442', '2.51.9', '2.51.10', '2.50.99']), '2.51.10');
  assert.strictEqual(G.enBuyukGSurum([null, 'e3b0c442']), null);
  assert.strictEqual(G.paketSurumuCoz('{"surum":" 2.51.3 "}'), '2.51.3');
  assert.strictEqual(G.paketSurumuCoz('bozuk'), null);
  assert.strictEqual(G.paketSurumuCoz(undefined), null);
});

test('KURAL 1 monoton: surum.json kurulu sürümden büyük değil → manifest HİÇ istenmez', async () => {
  for (const [ad, secenek] of [
    ['uygulanan G daha yeni', { yerelSurum: '2.51.5', surum: '2.51.4' }],
    ['paket sürümüne eşit', { paket: '2.51.2', surum: '2.51.2' }],
    ['paket sürümünden eski', { paket: '2.52.0', surum: '2.51.9' }],
  ]) {
    const { yerel, kayit } = kur(secenek);
    const r = await G.guncellemeyiCalistir(ortam(yerel));
    assert.strictEqual(r.durum, 'guncel', ad);
    assert.strictEqual(r.sebep, 'uzak-surum-buyuk-degil', ad);
    assert.deepStrictEqual(kayit.getir, [`${KOK}/surum.json`], ad);
    assert.strictEqual(dokunulmadi(kayit), 0, ad);
  }
});

test('KURAL 1 monoton: surum.json yalan söylese de İMZALI manifest eski/eşitse RET (geri alma yok)', async () => {
  for (const [ad, manSurum, secenek] of [
    ['uygulanan G\'ye eşit', '2.51.3', { yerelSurum: '2.51.3' }],
    ['uygulanan G\'den eski (eski imzalı manifestin yeniden oynatılması)', '2.51.1', { yerelSurum: '2.51.3' }],
    ['paket sürümünden eski', '2.51.4', { paket: '2.51.5' }],
  ]) {
    const { yerel, kayit } = kur({ ...imzali(manifest({ surum: manSurum })), surum: '2.51.9', ...secenek });
    const r = await G.guncellemeyiCalistir(ortam(yerel));
    assert.strictEqual(r.durum, 'red', ad);
    assert.strictEqual(r.sebep, 'manifest-reddedildi:surum-eski', ad);
    assert.strictEqual(dokunulmadi(kayit), 0, ad);
  }
});

test('KURAL 1 monoton: G3 biçimi dışı manifest sürümü (içerik-hash) → RET', async () => {
  const { yerel, kayit } = kur({ ...imzali(manifest({ surum: 'e3b0c44298fc1c14' })), surum: 'e3b0c44298fc1c14' });
  const r = await G.guncellemeyiCalistir(ortam(yerel));
  assert.strictEqual(r.sebep, 'manifest-reddedildi:surum-bicimi');
  assert.strictEqual(dokunulmadi(kayit), 0);
});

test('KURAL 1 monoton: KESİN büyük kabul (2.51.10 > 2.51.9); içerik-hash paket sürümü kıyasa girmez', async () => {
  const a = kur({ ...imzali(manifest({ surum: '2.51.10' })), surum: '2.51.10', yerelSurum: '2.51.9', paket: '2.51.2' });
  const r1 = await G.guncellemeyiCalistir(ortam(a.yerel));
  assert.strictEqual(r1.durum, 'guncellendi', JSON.stringify(r1));
  assert.strictEqual(r1.kuruluSurum, '2.51.9');
  assert.strictEqual(a.kayit.uygula[0].surum, '2.51.10');
  const b = kur({ ...imzali(manifest({ surum: '2.0.1' })), surum: '2.0.1', paket: 'a1b2c3d4e5f6' });
  const r2 = await G.guncellemeyiCalistir(ortam(b.yerel));
  assert.strictEqual(r2.durum, 'guncellendi', 'paketin İLK G\'si her G3\'ü alır');
  assert.strictEqual(r2.kuruluSurum, null);
});

test('KURAL 2 kimlik: başka setin / kimliksiz İMZALI manifesti → RET, hiçbir şeye dokunulmaz', async () => {
  for (const [ad, ek] of [['başka set', { setKimligi: '99999' }], ['kimlik yok', { setKimligi: undefined }],
    ['boş kimlik', { setKimligi: '' }], ['sayı ama farklı', { setKimligi: 73769 }]]) {
    const { yerel, kayit } = kur(imzali(manifest(ek)));
    const r = await G.guncellemeyiCalistir(ortam(yerel));
    assert.strictEqual(r.durum, 'red', ad);
    assert.strictEqual(r.sebep, 'manifest-reddedildi:baska-set', ad);
    assert.strictEqual(dokunulmadi(kayit), 0, ad);
  }
  const s = kur(imzali(manifest({ setKimligi: 73768 })));
  assert.strictEqual((await G.guncellemeyiCalistir(ortam(s.yerel))).durum, 'guncellendi', 'sayı biçimli aynı kimlik kabul');
});

test('KURAL 2 kimlik: kanal G değilse (K/Windows manifesti vb.) → RET', async () => {
  for (const kanal of ['K', 'g', undefined, null]) {
    const { yerel, kayit } = kur(imzali(manifest({ kanal })));
    const r = await G.guncellemeyiCalistir(ortam(yerel));
    assert.strictEqual(r.sebep, 'manifest-reddedildi:kanal-g-degil', String(kanal));
    assert.strictEqual(dokunulmadi(kayit), 0, String(kanal));
  }
});

test('KURAL 2 kimlik (tetik): surum.json başka seti söylüyorsa manifest HİÇ istenmez', async () => {
  const { yerel, kayit } = kur({ surumSet: '11811' });
  const r = await G.guncellemeyiCalistir(ortam(yerel));
  assert.strictEqual(r.durum, 'atlandi');
  assert.strictEqual(r.sebep, 'uzak-baska-set');
  assert.deepStrictEqual(kayit.getir, [`${KOK}/surum.json`]);
  const ayni = kur({ surumSet: '73768' });
  assert.strictEqual((await G.guncellemeyiCalistir(ortam(ayni.yerel))).durum, 'guncellendi');
});

test('KURAL 3 ya hep ya hiç: SON kitap düşerse uygula HİÇ çağrılmaz (kabuk + ilk kitap yalnız hazırlıkta)', async () => {
  const m = manifest();
  m.kitaplar.push({ dizin: 'book8', durum: 'ekle', kaynak: 'https://cdn.g.test/book8.zip', sha256: 'b'.repeat(64), boyut: 99, androidKaynak: 'https://cdn.g.test/book8.zip', androidSha256: 'b'.repeat(64), androidBoyut: 99 });
  const { yerel, kayit } = kur({ ...imzali(m), kitapHata: 'book8' });
  const r = await G.guncellemeyiCalistir(ortam(yerel));
  assert.strictEqual(r.durum, 'atlandi');
  assert.match(r.sebep, /^kitap-alinamadi:book8:baglanti-koptu/);
  assert.strictEqual(kayit.yaz.length, 3, 'kabuk hazırlığa indi');
  assert.deepStrictEqual(kayit.kitapKur.map((k) => k.dizin), ['book7', 'book8']);
  assert.strictEqual(kayit.uygula.length, 0, 'yarım güncelleme KESİNLEŞMEZ');
  assert.deepStrictEqual(r.eklenen, []);
});

test('KURAL 3 ya hep ya hiç: kabuk dosyası inmezse kitap kurulmaz, uygula yok', async () => {
  const { yerel, kayit } = kur({ dosyalar: { 'index.html': INDEX, [`book1/${MOTOR}`]: MOTOR_YENI } });
  const r = await G.guncellemeyiCalistir(ortam(yerel));
  assert.strictEqual(r.sebep, 'kabuk-indirilemedi:config/settings.json');
  assert.strictEqual(kayit.kitapKur.length + kayit.uygula.length, 0);
});

test('KURAL 3 ya hep ya hiç: bütün hazırlık (yaz, kitapKur) TEK uygula\'dan ÖNCE; uygula tam bir kez', async () => {
  const m = manifest();
  m.kitaplar.push({ dizin: 'book8', durum: 'ekle', kaynak: 'https://cdn.g.test/book8.zip', sha256: 'b'.repeat(64), boyut: 99, androidKaynak: 'https://cdn.g.test/book8.zip', androidSha256: 'b'.repeat(64), androidBoyut: 99 });
  const { yerel, kayit } = kur(imzali(m));
  const r = await G.guncellemeyiCalistir(ortam(yerel));
  assert.strictEqual(r.durum, 'guncellendi');
  assert.deepStrictEqual(kayit.sira, ['yaz', 'yaz', 'yaz', 'kitapKur', 'kitapKur', 'uygula']);
  const p = kayit.uygula[0];
  assert.strictEqual(p.dosyalar.length, 3);
  assert.deepStrictEqual(p.kitaplar.map((k) => k.dizin), ['book7', 'book8']);
  assert.deepStrictEqual(p.cikarilan, ['book3']);
});

/* ------------------------------------------------------------------------------------------------
 * Android Arşiv Alanları Denetimi (09.10 - Kalıcı Donma Kırılması)
 * ---------------------------------------------------------------------------------------------- */

test('Android arşiv alanları eksik → red/atlanır, indirme çağrısı 0', async () => {
  const m = manifest({
    kitaplar: [
      { dizin: 'book7', durum: 'ekle', kaynak: 'https://cdn.g.test/book7.zip', sha256: 'a'.repeat(64), boyut: 1234 }
    ]
  });
  const { yerel, kayit } = kur(imzali(m));
  const r = await G.guncellemeyiCalistir(ortam(yerel));
  assert.strictEqual(kayit.kitapKur.length, 0, 'indirme çağrısı 0 olmalı');
  const p = G.planKur(m, kabuk);
  assert.deepStrictEqual(p.atlanan, ['android-arsivi-eksik:book7'], 'planKur atlanan listesi');
  assert.deepStrictEqual(r.atlanan, ['android-arsivi-eksik:book7'], 'atlanan kitap RAPORDA görünür (sessiz değil)');
  assert.deepStrictEqual(r.eklenen, []);
});

test('GÜVENLİK: android alanı eksik kitap olsa da imza ÖNCE gelir — bozuk imza RED, planKur/atlanan yoluna hiç girilmez', async () => {
  const m = manifest({ kitaplar: [{ dizin: 'book7', durum: 'ekle', kaynak: 'https://cdn.g.test/book7.zip', sha256: 'a'.repeat(64), boyut: 1234 }] });
  const govde = Buffer.from(JSON.stringify(m));
  const s = Buffer.from(imzala(govde), 'base64'); s[10] ^= 1;
  const { yerel, kayit } = kur({ man: m, sig: s.toString('base64') });
  const r = await G.guncellemeyiCalistir(ortam(yerel));
  assert.strictEqual(r.durum, 'red');
  assert.strictEqual(r.sebep, 'manifest-imzasi-gecersiz:imza-tutmadi');
  assert.deepStrictEqual(r.atlanan, [], 'imza düşünce plan kurulmaz, atlanan boş kalır');
  assert.strictEqual(kayit.yaz.length + kayit.kitapKur.length + kayit.uygula.length, 0);
});

test('GÜVENLİK: androidKaynak/androidSha256/androidBoyut İMZA KAPSAMINDA — imzadan sonra tek alan oynarsa RED', async () => {
  const temiz = manifest();
  const sig = imzala(Buffer.from(JSON.stringify(temiz)));
  for (const [alan, deger] of [['androidKaynak', 'https://kotu.test/book7.zip'], ['androidSha256', 'b'.repeat(64)], ['androidBoyut', 1235]]) {
    const m = manifest();
    m.kitaplar[0][alan] = deger;
    const { yerel, kayit } = kur({ man: m, sig });
    const r = await G.guncellemeyiCalistir(ortam(yerel));
    assert.strictEqual(r.durum, 'red', alan);
    assert.strictEqual(r.sebep, 'manifest-imzasi-gecersiz:imza-tutmadi', alan);
    assert.strictEqual(kayit.kitapKur.length + kayit.uygula.length, 0, alan);
  }
});

test('DONMA GERÇEKTEN KIRILIR mı: atlanan kitap AYNI sürümde tekrar denenmez (sürüm damgalanır), Android alanlı YENİ sürümde kurulur', async () => {
  // 1) 2.51.2: book7 android alansız → atlanır, motor uygulanır, sürüm 2.51.2 damgalanır.
  const m1 = manifest({ kitaplar: [{ dizin: 'book7', durum: 'ekle', kaynak: 'https://cdn.g.test/book7.zip', sha256: 'a'.repeat(64), boyut: 1234 }] });
  const k1 = kur(imzali(m1));
  const r1 = await G.guncellemeyiCalistir(ortam(k1.yerel));
  assert.strictEqual(r1.durum, 'guncellendi');
  assert.deepStrictEqual(r1.atlanan, ['android-arsivi-eksik:book7']);
  assert.strictEqual(k1.kayit.uygula[0].surum, '2.51.2');
  // 2) Aynı 2.51.2 yeniden: sürüm eşit → manifest HİÇ istenmez → book7 tekrar denenmez (bilinçli: sessiz döngü yok,
  //    ama atlanan kitap yalnız yeni yayınla gelir).
  const k2 = kur({ ...imzali(m1), yerelSurum: '2.51.2' });
  const r2 = await G.guncellemeyiCalistir(ortam(k2.yerel));
  assert.strictEqual(r2.durum, 'guncel');
  assert.strictEqual(k2.kayit.getir.length, 1, 'yalnız surum.json');
  assert.strictEqual(k2.kayit.kitapKur.length, 0);
  // 3) 2.51.3: yayıncı book7'ye Android alanlarını ekledi → kurulur.
  const m3 = manifest({ surum: '2.51.3', kitaplar: [{ dizin: 'book7', durum: 'ekle', kaynak: 'https://cdn.g.test/book7.zip', sha256: 'a'.repeat(64), boyut: 1234,
    androidKaynak: 'https://cdn.g.test/book7-android.zip', androidSha256: 'c'.repeat(64), androidBoyut: 777 }] });
  const k3 = kur({ ...imzali(m3), surum: '2.51.3', yerelSurum: '2.51.2' });
  const r3 = await G.guncellemeyiCalistir(ortam(k3.yerel));
  assert.strictEqual(r3.durum, 'guncellendi', JSON.stringify(r3));
  assert.deepStrictEqual(r3.atlanan, []);
  assert.deepStrictEqual(r3.eklenen, ['book7']);
  assert.deepStrictEqual(k3.kayit.kitapKur[0], { dizin: 'book7', adres: 'https://cdn.g.test/book7-android.zip', sha256: 'c'.repeat(64), boyut: 777 });
});

test('Android arşiv alanları var → androidKaynak/Sha256/Boyut ile indirme yapılır', async () => {
  const m = manifest({
    kitaplar: [
      {
        dizin: 'book7',
        durum: 'ekle',
        kaynak: 'https://cdn.g.test/book7-electron.zip',
        sha256: 'e'.repeat(64),
        boyut: 9999,
        androidKaynak: 'https://cdn.g.test/book7-android.zip',
        androidSha256: 'a'.repeat(64),
        androidBoyut: 1234
      }
    ]
  });
  const { yerel, kayit } = kur(imzali(m));
  const r = await G.guncellemeyiCalistir(ortam(yerel));
  assert.strictEqual(r.durum, 'guncellendi');
  assert.strictEqual(kayit.kitapKur.length, 1);
  assert.deepStrictEqual(kayit.kitapKur[0], {
    dizin: 'book7',
    adres: 'https://cdn.g.test/book7-android.zip',
    sha256: 'a'.repeat(64),
    boyut: 1234
  });
});

test('bir kitap red (android-arsivi-eksik) + manifestteki motor düzeltmesi yine uygulanır (kalıcı donma kırılır)', async () => {
  const m = manifest({
    kitaplar: [
      { dizin: 'book7', durum: 'ekle', kaynak: 'https://cdn.g.test/book7.zip', sha256: 'a'.repeat(64), boyut: 1234 }
    ]
  });
  const { yerel, kayit } = kur(imzali(m));
  const r = await G.guncellemeyiCalistir(ortam(yerel));
  assert.strictEqual(r.durum, 'guncellendi');
  assert.strictEqual(kayit.kitapKur.length, 0);
  assert.strictEqual(kayit.uygula.length, 1);
  assert.strictEqual(kayit.uygula[0].surum, '2.51.2');
  assert.deepStrictEqual(kayit.uygula[0].kitaplar, []);
  assert.ok(kayit.uygula[0].dosyalar.some((d) => d.yol === `book1/${MOTOR}`));
});

test('Android sha256 uyuşmazlığı → red', async () => {
  const m1 = manifest({
    kitaplar: [
      {
        dizin: 'book7',
        durum: 'ekle',
        androidKaynak: 'https://cdn.g.test/book7-android.zip',
        androidSha256: 'gecersiz-sha256',
        androidBoyut: 1234
      }
    ]
  });
  assert.strictEqual(G.planKur(m1, kabuk).red, 'uyelik-ozet-boyut:book7');

  const m2 = manifest({
    kitaplar: [
      {
        dizin: 'book7',
        durum: 'ekle',
        androidKaynak: 'https://cdn.g.test/book7-android.zip',
        androidSha256: 'b'.repeat(64),
        androidBoyut: 1234
      }
    ]
  });
  const { yerel } = kur({ ...imzali(m2), kitapHata: 'book7' });
  const r = await G.guncellemeyiCalistir(ortam(yerel));
  assert.strictEqual(r.durum, 'atlandi');
  assert.match(r.sebep, /^kitap-alinamadi:book7/);
});
