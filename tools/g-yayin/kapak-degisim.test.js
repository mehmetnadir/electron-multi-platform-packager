'use strict';

/**
 * Kapak/menü değişimi G'ye menü olarak gider (06.10, Nadir): `yayinla.js --menu-kaynak` ve
 * `otomatik-yayin.js` menü sha kıyası + yeni kitap önerisi. Ağ/ssh/R2 YOK; build menüsü gerçek
 * dosya/zip baytlarıdır, canlı manifest test anahtarıyla imzalanır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const y = require('./yayinla');
const oy = require('./otomatik-yayin');
const anahtar = require('./anahtar');
const durum = require('./durum');
const gSurum = require('./g-surum');
const { MENU_ISARETI } = require('../../src/packaging/set-menu-bicim');

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const sessiz = { gunluk: () => {} };
const YAMA = durum.MENU_WEBZ_YAMA;
const AYAR = durum.MENU_WEBZ_AYAR;
const MASA = durum.MENU_MASA_TANIMI;
const WEBZ_INDEX = '<html><body><script src="scripts/language-set.js"></script></body>';

/* ------------------------------------------------------------------ yayinla fikstürleri */

function ortam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kapak-degisim-'));
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const anahtarYolu = path.join(d, 'test.key');
  fs.writeFileSync(anahtarYolu, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
    mode: 0o600,
  });
  return { d, anahtarYolu, acik: anahtar.acikAnahtarB64(privateKey), cikti: path.join(d, 'cikti') };
}

function ayarMetni(kitaplar, kapak) {
  const books = {};
  kitaplar.forEach((dz, i) => {
    books[dz] = { assetId: `5${i}`, contentType: 'book', coverUrl: kapak(dz), displayOrder: i,
      title: `Kitap ${i + 1}` };
  });
  return JSON.stringify({ bookCount: kitaplar.length, books, setTitle: 'Set' }, null, 2);
}

/** Web-Z menü dosyaları yazılmış dizin (kurulu paket kökü ya da build kökü). */
function webzDizin(d, ad, kitaplar, kapak, { yamaKitaplar = kitaplar, index = WEBZ_INDEX } = {}) {
  const kok = path.join(d, ad);
  const yaz = (g, v) => {
    fs.mkdirSync(path.dirname(path.join(kok, g)), { recursive: true });
    fs.writeFileSync(path.join(kok, g), v);
  };
  yaz('index.html', index);
  yaz(YAMA, `(function () {\n  window.__setSettings = ${ayarMetni(yamaKitaplar, kapak)};\n})();\n`);
  yaz(AYAR, ayarMetni(kitaplar, kapak) + '\n');
  yaz(MASA, JSON.stringify({ kitaplar: kitaplar.map((k) => ({ ad: k, klasor: k })) }));
  yaz('empp-set.json', JSON.stringify({ sema: 2, setKimligi: '99901' }));
  for (const k of kitaplar) yaz(`${k}/index.html`, '<html></html>');
  return kok;
}

const ESKI_KAPAK = (dz) => `${dz}/assets/x/thumbs/1.jpg`;
const YENI_KAPAK = (dz) => `data:image/jpeg;base64,${Buffer.from(dz).toString('base64')}`;
const TABAN = 'https://ornek.invalid/guncelleme';

function temel(o, ek) {
  return { komut: 'yayinla', setKimligi: '99901', taban: TABAN, cikti: o.cikti,
    anahtarDosya: o.anahtarYolu, anahtarZinciri: false, motorlar: {}, ekle: {}, cikar: [],
    ilk: true, oncekiSurum: '2.70.1', panel: 70, ...ek };
}

/* ------------------------------------------------------------------ yayinla --menu-kaynak */

test('argsAyristir: --menu-kaynak değeri alır', () => {
  assert.equal(y.argsAyristir(['--menu-kaynak', '/b.zip']).menuKaynak, '/b.zip');
  assert.equal(y.argsAyristir([]).menuKaynak, null);
});

test('menu-kaynak: yalnız kapak data: değişti → degisiklik.menu, kitaplar aynı, baytlar birebir', async () => {
  const o = ortam();
  const kitaplar = ['book1', 'book2', 'book3'];
  const taban = webzDizin(o.d, 'kurulu', kitaplar, ESKI_KAPAK);
  const build = webzDizin(o.d, 'build', kitaplar, YENI_KAPAK);
  const r = await y.yayinla(temel(o, { menuKaynak: build, menuTaban: taban }), sessiz);
  assert.equal(r.menu.kaynak, 'menu-kaynak');
  assert.deepEqual(r.menu.degisen, [AYAR, YAMA, MASA].sort());
  const set = path.join(o.cikti, 'set', '99901');
  const m = JSON.parse(fs.readFileSync(path.join(set, 'manifest.json'), 'utf8'));
  assert.deepEqual(m.kitaplar, [], 'kitap kümesi değişmedi');
  assert.ok(!m.kabuk.some((g) => g.yol === 'index.html'), "index.html G'ye menü olarak gitmez");
  for (const yol of [YAMA, AYAR, MASA]) {
    const g = m.kabuk.find((k) => k.yol === yol);
    assert.ok(g, `${yol} imzalı kabukta`);
    const yayin = fs.readFileSync(path.join(set, 'dosya', ...yol.split('/')));
    const kaynak = fs.readFileSync(path.join(build, ...yol.split('/')));
    assert.ok(yayin.equals(kaynak), `${yol} build baytlarıyla birebir`);
    assert.equal(g.sha256, sha(kaynak));
    assert.ok(fs.existsSync(path.join(set, 'android', 'dosya', ...yol.split('/'))), 'android ucu');
  }
  assert.match(
    fs.readFileSync(path.join(set, 'dosya', ...AYAR.split('/')), 'utf8'), /data:image\/jpeg/);
  assert.equal(y.ciktiDogrula({ cikti: o.cikti, setKimligi: '99901', acik: o.acik }).gecti, true);
  // Android kapısı: yalnız menü değişimi serbest (--ekle yok → kapı ilgisiz, donuk değil).
  assert.deepEqual(y.androidEklemeKapisi(temel(o, { menuKaynak: build })), []);
  assert.equal(r.android.donuk, false);
});

test('menu-kaynak: build.zip kaynağı (unzip -p) dizinle aynı baytları verir', async () => {
  const o = ortam();
  const kitaplar = ['book1', 'book2'];
  const taban = webzDizin(o.d, 'kurulu', kitaplar, ESKI_KAPAK);
  const build = webzDizin(o.d, 'build', kitaplar, YENI_KAPAK);
  const zipYolu = path.join(o.d, 'build.zip');
  const z = spawnSync('zip', ['-q', '-r', zipYolu, '.'], { cwd: build });
  assert.equal(z.status, 0);
  const r = await y.yayinla(temel(o, { menuKaynak: zipYolu, menuTaban: taban }), sessiz);
  const set = path.join(o.cikti, 'set', '99901');
  const yayin = fs.readFileSync(path.join(set, 'dosya', ...AYAR.split('/')));
  assert.ok(yayin.equals(fs.readFileSync(path.join(build, ...AYAR.split('/')))));
  assert.equal(r.menu.bicim, 'webz');
});

test('menu-kaynak: kart kümesi değişti → RED (--ekle/--cikar kullan)', async () => {
  const o = ortam();
  const taban = webzDizin(o.d, 'kurulu', ['book1', 'book2', 'book3'], ESKI_KAPAK);
  const build = webzDizin(o.d, 'build', ['book1', 'book2', 'book3', 'book4'], YENI_KAPAK);
  await assert.rejects(
    y.yayinla(temel(o, { menuKaynak: build, menuTaban: taban }), sessiz),
    /menu-kart-kumesi-degisti: --ekle\/--cikar kullan/,
  );
  assert.ok(!fs.existsSync(path.join(o.cikti, 'set', '99901', 'manifest.json')), 'yayın üretilmedi');
});

test('menu-kaynak: yama ile settings books farklı → RED', async () => {
  const o = ortam();
  const kitaplar = ['book1', 'book2'];
  const taban = webzDizin(o.d, 'kurulu', kitaplar, ESKI_KAPAK);
  const build = webzDizin(o.d, 'build', kitaplar, YENI_KAPAK, { yamaKitaplar: ['book1'] });
  await assert.rejects(
    y.yayinla(temel(o, { menuKaynak: build, menuTaban: taban }), sessiz),
    /menü-books-ayrisik/,
  );
});

test('menu-kaynak: K17 menüsü → index-yasak-k17; --ekle ile birlikte → RED; taban yoksa build dizinleri', async () => {
  const o = ortam();
  const kitaplar = ['book1', 'book2'];
  const k17 = `${MENU_ISARETI}\n<!DOCTYPE html>\n<html><body>\n  <main>\n  </main>\n</body></html>\n`;
  const build = webzDizin(o.d, 'build', kitaplar, YENI_KAPAK, { index: k17 });
  await assert.rejects(y.yayinla(temel(o, { menuKaynak: build }), sessiz), /index-yasak-k17/);
  const iyi = webzDizin(o.d, 'build2', kitaplar, YENI_KAPAK);
  await assert.rejects(
    y.yayinla(temel(o, { menuKaynak: iyi, cikar: ['book1'] }), sessiz),
    /--ekle\/--cikar\/--index ile birlikte verilmez/,
  );
  // Kurulu taban bilinmiyorsa kıyas build'in kendi bookN dizinleriyle yapılır (kartlar eşit → geçer).
  const r = await y.yayinla(temel(o, { menuKaynak: iyi }), sessiz);
  assert.equal(r.menu.degisen.length, 3);
  // Aynı menüyü ikinci kez yayınlamak boşuna sürümdür → RED (idempotent).
  await assert.rejects(
    y.yayinla(temel(o, { ilk: false, oncekiSurum: null, menuKaynak: iyi }), sessiz),
    /önceki sürümle aynı içerik/,
  );
});

/* ------------------------------------------------------------------ otomatik-yayin fikstürleri */

const MOTOR = durum.MOTOR_DOSYA_ADI;
const KANONIK_SHA = '03e8af70a0f3' + 'a'.repeat(52);
const KANONIK = { sha12: '03e8af70a0f3', sha256: KANONIK_SHA, boyut: 548196, yol: '/x/motor/' + MOTOR };
const OTO_TABAN = 'https://cdn.ydspublishing.com/guncelleme';
const { privateKey: OZEL } = crypto.generateKeyPairSync('ed25519');
const ACIK = anahtar.acikAnahtarB64(OZEL);
delete process.env.G_OTO_GEREKLI;

const KITAPLAR4 = JSON.stringify([1, 2, 3, 4].map((n) => ({ n, id: String(25770 + n), vs: 1 })));
const KITAPLAR5 = JSON.stringify([1, 2, 3, 4, 5].map((n) => ({ n, id: String(25770 + n), vs: 1 })));

function tsv(b, s) {
  return [b.join('\t'), ...s.map((r) => r.join('\t'))].join('\n') + '\n';
}

function sahteSql({ gecerli = KITAPLAR4, onceki = KITAPLAR4, sayac = '7' } = {}) {
  return async (sql) => {
    if (sql.includes('FROM pipeline_book_summaries b WHERE')) {
      return tsv(['book_id', 'book_title', 'publisher_name', 'set_paket_sayaci'],
        [['45550', 'Set', 'YDS Publishing', sayac]]);
    }
    if (sql.includes('pipeline_platform_summaries')) {
      return tsv(['book_id', 'platform', 'status', 'paket_sayaci', 'motor_sha12', 'motor_durum',
        'kabuk_surum', 'kabuk_durum', 'last_run_at'],
      ['windows', 'pardus', 'mac', 'android'].map((p) => ['45550', p, 'completed', sayac,
        '03e8af70a0f3', 'guncel', '1.13.14', 'guncel', '2026-10-06 11:02:16']));
    }
    return tsv(['set_id', 'surum', 'sha256', 'boyut', 'durum', 'kitaplar'], [
      ['45550', '2.25.7', 'b'.repeat(64), '1', 'gecerli', gecerli],
      ['45550', '2.25.6', 'c'.repeat(64), '1', 'yedek', onceki]]);
  };
}

/** Canlı G: motorlar kanonik; menü girdileri `menuSha` (yol → sha) ile. */
function canliGetir(menuSha = {}) {
  const kok = `${OTO_TABAN}/set/45550`;
  const kabuk = [1, 2, 3, 4].map((n) => ({ yol: `book${n}/${MOTOR}`, sha256: KANONIK_SHA, boyut: 1 }));
  for (const [yol, h] of Object.entries(menuSha)) kabuk.push({ yol, sha256: h, boyut: 1 });
  const govde = Buffer.from(JSON.stringify({ sema: 1, kanal: 'G', setKimligi: '45550',
    surum: '2.25.8', onceki: null, uretim: '2026-10-06T00:00:00Z', anahtar: 'x', kabuk, kitaplar: [] }));
  const imza = crypto.sign(null, govde, OZEL).toString('base64');
  const tablo = {
    [`${kok}/surum.json`]: JSON.stringify({ surum: '2.25.8', setKimligi: '45550' }),
    [`${kok}/manifest.json`]: govde,
    [`${kok}/manifest.json.sig`]: imza,
    [`${kok}/android/surum.json`]: JSON.stringify({ surum: '2.25.8' }),
  };
  const istekler = [];
  const f = async (adres) => {
    istekler.push(adres);
    const v = tablo[adres];
    return v === undefined ? { durum: 404, govde: Buffer.from('') } : { durum: 200, govde: Buffer.from(v) };
  };
  f.istekler = istekler;
  return f;
}

function oOps(ek = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kapak-oto-'));
  return { kanonik: KANONIK, zipListe: null, acik: ACIK, logYolu: path.join(d, 'log'),
    kilitYolu: path.join(d, 'kilit'), bildirimYolu: path.join(d, 'b.json'), bildir: () => {},
    simdi: Date.parse('2026-10-06T12:00:00Z'), ...ek };
}

/** Build menü kaynağı (enjekte): Web-Z menü dosyaları bellekte, gerçek baytlar. */
function buildMenu(kapak, { index = WEBZ_INDEX } = {}) {
  const kitaplar = ['book1', 'book2', 'book3', 'book4'];
  const dosyalar = new Map([
    ['index.html', Buffer.from(index)],
    [YAMA, Buffer.from(`window.__setSettings = ${ayarMetni(kitaplar, kapak)};\n`)],
    [AYAR, Buffer.from(ayarMetni(kitaplar, kapak) + '\n')],
  ]);
  return { yol: '/build/kaynak/build.zip', dosyalar, kitapDizinleri: kitaplar };
}

const menuShalari = (mk) => ({ [YAMA]: sha(mk.dosyalar.get(YAMA)), [AYAR]: sha(mk.dosyalar.get(AYAR)) });

/* ------------------------------------------------------------------ otomatik-yayin menü */

test('otomatik: motor aynı + menü farklı → SEÇ (tur menu), plan --menu-kaynak taşır', async () => {
  const yeni = buildMenu(YENI_KAPAK);
  const eski = buildMenu(ESKI_KAPAK);
  const getir = canliGetir(menuShalari(eski));
  const r = await oy.kos(oy.argsAyristir(['45550']),
    oOps({ getir, sql: sahteSql(), menuKaynak: yeni }));
  const s = r.setler[0];
  assert.equal(s.karar, 'sec');
  assert.equal(s.tur, 'menu');
  assert.match(s.sebep, /^menu-degisti\(/);
  assert.deepEqual(s.menu.farkli, [AYAR, YAMA].sort());
  const uret = s.komutlar[0].arg;
  assert.equal(uret[uret.indexOf('--menu-kaynak') + 1], yeni.yol);
  assert.ok(!uret.includes('--motor'), 'yalnız menü seçiminde motor taşınmaz');
  // Plan yayinla.js ayrıştırıcısından geçer; Android kapısı ilgisiz (--ekle yok).
  const u = y.argsAyristir(uret);
  assert.equal(u.menuKaynak, yeni.yol);
  assert.deepEqual(y.androidEklemeKapisi(u), []);
  assert.ok(!uret.includes('--ekle') && !uret.includes('--android-ekleme-dondurur-kabul'));
});

test('otomatik: motor ve menü canlıyla aynı → güncel', async () => {
  const yeni = buildMenu(YENI_KAPAK);
  const getir = canliGetir(menuShalari(yeni));
  const r = await oy.kos(oy.argsAyristir(['45550']),
    oOps({ getir, sql: sahteSql(), menuKaynak: yeni }));
  assert.equal(r.setler[0].karar, 'guncel');
  assert.equal(r.setler[0].menu.durum, 'ayni');
  assert.equal(r.setler[0].komutlar, undefined);
});

test('otomatik: canlı manifest menü taşımıyorsa SEÇ (birikimli örtü ilk kez kurulur)', async () => {
  const yeni = buildMenu(YENI_KAPAK);
  const r = await oy.kos(oy.argsAyristir(['45550']),
    oOps({ getir: canliGetir({}), sql: sahteSql(), menuKaynak: yeni }));
  assert.equal(r.setler[0].karar, 'sec');
  assert.equal(r.setler[0].tur, 'menu');
});

test('otomatik: menü ve motor birlikte farklı → tek yayında ikisi (motor+menu)', async () => {
  const yeni = buildMenu(YENI_KAPAK);
  const kok = `${OTO_TABAN}/set/45550`;
  const getir = canliGetir(menuShalari(buildMenu(ESKI_KAPAK)));
  const eskiGetir = getir;
  const sarmal = async (adres) => {
    const r = await eskiGetir(adres);
    if (adres === `${kok}/manifest.json`) {
      const m = JSON.parse(Buffer.from(r.govde).toString('utf8'));
      m.kabuk[0].sha256 = 'e'.repeat(64);
      const g = Buffer.from(JSON.stringify(m));
      return { durum: 200, govde: g };
    }
    if (adres === `${kok}/manifest.json.sig`) {
      const m = await eskiGetir(`${kok}/manifest.json`);
      const j = JSON.parse(Buffer.from(m.govde).toString('utf8'));
      j.kabuk[0].sha256 = 'e'.repeat(64);
      return { durum: 200, govde: Buffer.from(crypto.sign(null, Buffer.from(JSON.stringify(j)), OZEL)
        .toString('base64')) };
    }
    return r;
  };
  const r = await oy.kos(oy.argsAyristir(['45550']),
    oOps({ getir: sarmal, sql: sahteSql(), menuKaynak: yeni }));
  const s = r.setler[0];
  assert.equal(s.karar, 'sec');
  assert.equal(s.tur, 'motor+menu');
  assert.match(s.sebep, /motor-farki.*menu-degisti/);
  const uret = s.komutlar[0].arg;
  assert.ok(uret.includes('--menu-kaynak') && uret.includes('--motor'));
});

test('otomatik: K17 menüsü → index yasak (index-yasak-k17), plan yok', async () => {
  const k17 = `${MENU_ISARETI}\n<!DOCTYPE html>\n<html><body>\n  <main>\n  </main>\n</body></html>\n`;
  const mk = buildMenu(YENI_KAPAK, { index: k17 });
  const r = await oy.kos(oy.argsAyristir(['45550']),
    oOps({ getir: canliGetir({}), sql: sahteSql(), menuKaynak: mk }));
  const s = r.setler[0];
  assert.equal(s.karar, 'guncel');
  assert.match(s.sebep, /index-yasak-k17/);
  assert.ok(s.uyarilar.some((u) => u.startsWith('index-yasak-k17')));
  assert.equal(s.komutlar, undefined);
});

test('otomatik: menü kaynağı okunamıyor + canlı menü taşıyor → örtü uyarısı (--dusur önerisi)', async () => {
  const getir = canliGetir(menuShalari(buildMenu(ESKI_KAPAK)));
  const r = await oy.kos(oy.argsAyristir(['45550']),
    oOps({ getir, sql: sahteSql(), menuKaynak: { yol: '/x.zip', hata: 'zip okunamadı' } }));
  const s = r.setler[0];
  assert.equal(s.karar, 'guncel');
  assert.ok(s.uyarilar.some((u) => /menu-ortusu-dogrulanamadi.*--dusur/.test(u)), s.uyarilar.join('|'));
});

test('otomatik: paket sürümü artmış + eski menü örtüsü → yeni G sürümü paketten KESİN büyük', async () => {
  const yeni = buildMenu(YENI_KAPAK);
  const getir = canliGetir(menuShalari(buildMenu(ESKI_KAPAK)));
  const r = await oy.kos(oy.argsAyristir(['45550']),
    oOps({ getir, sql: sahteSql({ sayac: '12' }), menuKaynak: yeni }));
  const s = r.setler[0];
  assert.equal(s.karar, 'sec');
  assert.equal(s.paketSurum, '2.25.12');
  assert.equal(gSurum.kiyasla(s.tahminiSurum, s.paketSurum) > 0, true, s.tahminiSurum);
});

test('otomatik: yeni kitap → Electron --ekle önerisi, Android yeni pakete (ekleme yok, adım koşmaz)', async () => {
  const getir = canliGetir({});
  const r = await oy.kos(oy.argsAyristir(['45550', '--uygula']),
    oOps({ getir, sql: sahteSql({ gecerli: KITAPLAR5 }), menuKaynak: buildMenu(YENI_KAPAK),
      adimKos: async () => assert.fail('yeni kitapta adım koşmamalı') }));
  const s = r.setler[0];
  assert.equal(s.karar, 'nadir');
  assert.deepEqual(s.oneri.ekle, ['book5']);
  assert.deepEqual(s.oneri.electron, ['windows', 'pardus', 'mac']);
  assert.ok(!s.oneri.electron.includes('android'), 'Android --ekle listesinde yok');
  assert.equal(s.oneri.android, 'android-yeni-paket');
  assert.equal(s.komutlar, undefined);
  assert.equal(getir.istekler.length, 0);
  const metin = oy.ozetMetni(r);
  assert.match(metin, /android-yeni-paket/);
});

test('saf: yeniKitapOnerisi yalnız eklemede; menuFarki sha kıyaslar', () => {
  assert.equal(oy.yeniKitapOnerisi({ eklenen: [], cikan: [1], degisen: [] }), null);
  assert.deepEqual(oy.yeniKitapOnerisi({ eklenen: [5, 6] }).ekle, ['book5', 'book6']);
  const v = Buffer.from('x');
  const m = { kabuk: [{ yol: AYAR, sha256: sha(v) }, { yol: YAMA, sha256: 'e'.repeat(64) }] };
  assert.deepEqual(oy.menuFarki(new Map([[AYAR, v], [YAMA, v], [MASA, v]]), m), [MASA, YAMA].sort());
});
