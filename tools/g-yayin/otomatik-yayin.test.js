'use strict';

/**
 * otomatik-yayin.js — DB çıktısı (TSV) ve HTTP sahte; ağ, ssh, rclone, Anahtar Zinciri YOK.
 * Canlı manifest fikstürü test ed25519 anahtarıyla imzalanır (üretim anahtarına dokunulmaz).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const oy = require('./otomatik-yayin');
const anahtar = require('./anahtar');

const MOTOR = '43e23fce2b7009474555a77.js';
const KANONIK_SHA = '03e8af70a0f3' + 'a'.repeat(52);
const KANONIK = { sha12: '03e8af70a0f3', sha256: KANONIK_SHA, boyut: 548196,
  yol: '/x/motor/' + MOTOR };
const TABAN = 'https://cdn.ydspublishing.com/guncelleme';

const { privateKey: OZEL } = crypto.generateKeyPairSync('ed25519');
const ACIK = anahtar.acikAnahtarB64(OZEL);

function geciciDizin() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'g-otomatik-test-'));
}

function tsv(basliklar, satirlar) {
  return [basliklar.join('\t'), ...satirlar.map((s) => s.join('\t'))].join('\n') + '\n';
}

const KITAP_B = ['book_id', 'book_title', 'publisher_name', 'set_paket_sayaci'];
const PLAT_B = ['book_id', 'platform', 'status', 'paket_sayaci', 'motor_sha12', 'motor_durum',
  'kabuk_surum', 'kabuk_durum', 'last_run_at'];
const BUILD_B = ['set_id', 'surum', 'sha256', 'boyut', 'durum', 'kitaplar'];

const KITAPLAR4 = JSON.stringify([1, 2, 3, 4].map((n) => ({ n, id: String(25770 + n), vs: 1 })));
const KITAPLAR5 = JSON.stringify([1, 2, 3, 4, 5].map((n) => ({ n, id: String(25770 + n), vs: 1 })));

function platSatirlari(id, ops = {}) {
  return ['windows', 'pardus', 'mac', 'android'].map((p) => [
    id, p, (ops.status || {})[p] || 'completed', '7', '03e8af70a0f3', 'guncel',
    (ops.kabuk || {})[p] || '1.13.14', 'guncel', '2026-10-06 11:02:16',
  ]);
}

/** Sahte pipeline-sql: sorgu türüne göre TSV. */
function sahteSql({ id = '45550', plat, gecerliKitaplar = KITAPLAR4,
  oncekiKitaplar = KITAPLAR4 } = {}) {
  const sorgular = [];
  const f = async (sql) => {
    sorgular.push(sql);
    assert.ok(!sql.includes(';'), 'pipeline-sql tek SELECT, ; yok');
    if (sql.includes('FROM pipeline_book_summaries b WHERE')) {
      return tsv(KITAP_B, [[id, 'Shall We?! 6 Set', 'YDS Publishing', '7']]);
    }
    if (sql.includes('pipeline_platform_summaries')) return tsv(PLAT_B, plat || platSatirlari(id));
    if (sql.includes('kaynak_build_surumleri')) {
      return tsv(BUILD_B, [
        [id, '2.25.7', 'b'.repeat(64), '1029604690', 'gecerli', gecerliKitaplar],
        [id, '2.25.6', 'c'.repeat(64), '1032002954', 'yedek', oncekiKitaplar],
      ]);
    }
    throw new Error('beklenmeyen sorgu: ' + sql);
  };
  f.sorgular = sorgular;
  return f;
}

function imzaliManifest(id, surum, kabuk) {
  const govde = Buffer.from(JSON.stringify({ sema: 1, kanal: 'G', setKimligi: id, surum,
    onceki: null, uretim: '2026-10-06T00:00:00Z', anahtar: 'x', kabuk, kitaplar: [] }));
  return { govde, imza: crypto.sign(null, govde, OZEL).toString('base64') };
}

/** Sahte getir: adres → {durum, govde}; tanımsız adres 404. İstekler kaydedilir. */
function sahteGetir(tablo) {
  const istekler = [];
  const f = async (adres) => {
    istekler.push(adres);
    const v = tablo[adres];
    if (v === undefined) return { durum: 404, govde: Buffer.from('') };
    if (typeof v === 'number') return { durum: v, govde: Buffer.from('') };
    return { durum: 200, govde: Buffer.from(v) };
  };
  f.istekler = istekler;
  return f;
}

function canliTablo(id, { surum = '2.25.8', motorSha = KANONIK_SHA, android = true,
  index = null } = {}) {
  const kok = `${TABAN}/set/${id}`;
  const kabuk = [1, 2, 3, 4].map((n) => ({ yol: `book${n}/${MOTOR}`, sha256: motorSha,
    boyut: 548196 }));
  if (index !== null) {
    kabuk.push({ yol: 'index.html', sha256: 'd'.repeat(64), boyut: index.length });
  }
  const m = imzaliManifest(id, surum, kabuk);
  const t = {
    [`${kok}/surum.json`]: JSON.stringify({ surum, setKimligi: id }),
    [`${kok}/manifest.json`]: m.govde,
    [`${kok}/manifest.json.sig`]: m.imza,
  };
  if (android) t[`${kok}/android/surum.json`] = JSON.stringify({ surum });
  if (index !== null) t[`${kok}/android/dosya/index.html`] = index;
  return t;
}

function ortam(ek = {}) {
  const d = geciciDizin();
  const bildirimler = [];
  return {
    d,
    bildirimler,
    ops: {
      kanonik: KANONIK,
      zipListe: null,
      acik: ACIK,
      logYolu: path.join(d, 'g-otomatik.log'),
      kilitYolu: path.join(d, 'kilit'),
      bildirimYolu: path.join(d, 'bildirim.json'),
      bildir: (m) => bildirimler.push(m),
      simdi: Date.parse('2026-10-06T12:00:00Z'),
      ...ek,
    },
  };
}

function logSatirlari(yol) {
  return fs.readFileSync(yol, 'utf8').trim().split('\n').map((s) => JSON.parse(s));
}

/* ------------------------------------------------------------------ saf parçalar */

test('argsAyristir: varsayılan kuru; set listesi ya da --tum-yds zorunlu; kimlik sayı', () => {
  const a = oy.argsAyristir(['45550', '--set', '11845,45550']);
  assert.equal(a.kip, 'kuru');
  assert.deepEqual(a.setler, ['45550', '11845']);
  assert.equal(oy.argsAyristir(['--tum-yds', '--uygula']).kip, 'uygula');
  assert.throws(() => oy.argsAyristir([]), /set listesi/);
  assert.throws(() => oy.argsAyristir(['45550;drop']), /sayı olmalı/);
  assert.throws(() => oy.argsAyristir(['--bilinmez']), /bilinmeyen/);
});

test('tsvAyristir: başlık + NULL → null; boş çıktı (0 satır) → []', () => {
  const r = oy.tsvAyristir('a\tb\n1\tNULL\n');
  assert.deepEqual(r, [{ a: '1', b: null }]);
  assert.deepEqual(oy.tsvAyristir(''), []);
});

test('sqlleriKur: tek SELECT, ; yok, kimlik yalnız rakam', () => {
  const q = oy.sqlleriKur({ setler: ['45550', '11845'], tumYds: false });
  for (const s of Object.values(q)) {
    assert.ok(s.startsWith('SELECT '));
    assert.ok(!s.includes(';'));
  }
  assert.match(q.kitaplar, /IN \(45550,11845\)/);
  assert.match(oy.sqlleriKur({ setler: [], tumYds: true }).platformlar, /YDS Publishing/);
  assert.throws(() => oy.sqlleriKur({ setler: ["1' OR 1=1"] }), /kimlik/);
});

test('paketSurumu: 2.<build paneli>.<en büyük sayaç>', () => {
  const g = { surum: '2.25.7' };
  assert.equal(oy.paketSurumu(g, [{ paket_sayaci: '7' }, { paket_sayaci: '8' }], {}), '2.25.8');
  assert.equal(oy.paketSurumu(g, [], { set_paket_sayaci: '7' }), '2.25.7');
});

test('motorDizinleri: yerel build listesi kesin (A1 → boş), yoksa DB n', () => {
  const zip = [`book1/${MOTOR}`, `book3/${MOTOR}`, `book1/assets/1/etk/${MOTOR}`, MOTOR];
  assert.deepEqual(oy.motorDizinleri({ kitaplar: KITAPLAR4 }, zip).dizinler, ['book1', 'book3']);
  const a1 = oy.motorDizinleri({ kitaplar: KITAPLAR4 }, [MOTOR, 'kapak/index.html']);
  assert.deepEqual(a1.dizinler, []);
  const db = oy.motorDizinleri({ kitaplar: KITAPLAR4 }, null);
  assert.deepEqual(db, { dizinler: ['book1', 'book2', 'book3', 'book4'], kaynak: 'db-kitaplar' });
});

test('bilesimKiyasla: ekleme/çıkarma/değişim; önceki yoksa değişmedi + not', () => {
  const e = oy.bilesimKiyasla({ kitaplar: KITAPLAR5 }, { kitaplar: KITAPLAR4 });
  assert.equal(e.degisti, true);
  assert.deepEqual(e.eklenen, [5]);
  const d = oy.bilesimKiyasla({ kitaplar: '[{"n":1,"id":"9"}]' },
    { kitaplar: '[{"n":1,"id":"8"}]' });
  assert.deepEqual(d.degisen, [1]);
  assert.equal(oy.bilesimKiyasla({ kitaplar: KITAPLAR4 }, null).sebep, 'onceki-build-yok');
  assert.equal(oy.bilesimKiyasla({ kitaplar: KITAPLAR4 }, { kitaplar: KITAPLAR4 }).degisti, false);
});

test('motorDenetle: DB motor_sha12 kanonikten farklıysa tamam değil', () => {
  const satir = platSatirlari('1').map((r) => Object.fromEntries(PLAT_B.map((b, i) => [b, r[i]])));
  assert.equal(oy.motorDenetle(satir, KANONIK).tamam, true);
  satir[2].motor_sha12 = 'ffffffffffff';
  assert.match(oy.motorDenetle(satir, KANONIK).sebep, /mac:ffffffffffff/);
  assert.equal(oy.motorDenetle(satir, null).sebep, 'kanonik-motor-yok');
});

test('kanonikMotorOku: sha256 öneki ve boyut tutmalı', () => {
  const d = geciciDizin();
  const dosya = path.join(d, MOTOR);
  fs.writeFileSync(dosya, 'motor içeriği');
  const sha = crypto.createHash('sha256').update('motor içeriği').digest('hex');
  const json = path.join(d, 'kanonik.json');
  const boyut = fs.statSync(dosya).size;
  fs.writeFileSync(json, JSON.stringify({ sha12: sha.slice(0, 12), boyut }));
  assert.equal(oy.kanonikMotorOku(json, dosya).sha256, sha);
  fs.writeFileSync(json, JSON.stringify({ sha12: '000000000000' }));
  assert.equal(oy.kanonikMotorOku(json, dosya), null);
});

/* ------------------------------------------------------------------ istenen beş senaryo */

test('4 platform bitmemiş → seçilmez (bitmemis), canlıya hiç gidilmez', async () => {
  const { ops } = ortam();
  const getir = sahteGetir({});
  const plat = platSatirlari('45550', { status: { android: 'queued', mac: 'queued' } });
  const r = await oy.kos(oy.argsAyristir(['45550']), { ...ops, getir, sql: sahteSql({ plat }) });
  assert.equal(r.setler[0].karar, 'bitmemis');
  assert.match(r.setler[0].sebep, /mac:queued/);
  assert.match(r.setler[0].sebep, /android:queued/);
  assert.equal(getir.istekler.length, 0);
  assert.equal(r.cikis, 0);
});

test('kabuk sürümü hedef değil → bitmemis', async () => {
  const { ops } = ortam();
  const plat = platSatirlari('45550', { kabuk: { pardus: '1.13.3' } });
  const r = await oy.kos(oy.argsAyristir(['45550']),
    { ...ops, getir: sahteGetir({}), sql: sahteSql({ plat }) });
  assert.equal(r.setler[0].karar, 'bitmemis');
  assert.match(r.setler[0].sebep, /pardus:kabuk-1\.13\.3/);
});

test('surum.json 404 → seçilir (ilk); plan --ilk + kanonik motor + canlı önceki', async () => {
  const { ops } = ortam();
  const r = await oy.kos(oy.argsAyristir(['45550']),
    { ...ops, getir: sahteGetir({}), sql: sahteSql() });
  const s = r.setler[0];
  assert.equal(s.karar, 'sec');
  assert.match(s.sebep, /^ilk/);
  assert.equal(s.paketSurum, '2.25.7');
  assert.equal(s.tahminiSurum, '2.25.8');
  const uret = s.komutlar[0].arg;
  assert.ok(uret.includes('--ilk'));
  assert.ok(uret.includes('--anahtar-zinciri'));
  assert.ok(!uret.includes('--index'), 'index otomatik yayınlanmaz');
  assert.ok(!uret.includes('--ekle'));
  assert.equal(uret[uret.indexOf('--onceki-surum') + 1], '2.25.7');
  assert.equal(uret[uret.indexOf('--onceki-manifest') + 1], `${TABAN}/set/45550/manifest.json`);
  assert.equal(uret.filter((x) => x === '--motor').length, 4);
  assert.ok(uret.includes(`book4=${KANONIK.yol}`));
  assert.deepEqual(s.komutlar.map((k) => k.ad), ['uret', 'yukle', 'dogrula']);
  assert.ok(s.komutlar[1].arg.includes('--onayli'));
  assert.equal(s.plan.length, 3);
  // Kuru kip: hiçbir adım koşmaz, bildirim gitmez.
  assert.equal(s.uygulama, undefined);
});

test('G sürümü güncel (motorlar kanonik, android ucu var) → seçilmez', async () => {
  const { ops } = ortam();
  const r = await oy.kos(oy.argsAyristir(['45550']),
    { ...ops, getir: sahteGetir(canliTablo('45550')), sql: sahteSql() });
  assert.equal(r.setler[0].karar, 'guncel');
  assert.equal(r.setler[0].komutlar, undefined);
});

test('canlı G var ama motor farklı → seçilir, yeni sürüm canlıdan büyük', async () => {
  const { ops } = ortam();
  const getir = sahteGetir(canliTablo('45550', { surum: '2.25.9', motorSha: 'e'.repeat(64) }));
  const r = await oy.kos(oy.argsAyristir(['45550']), { ...ops, getir, sql: sahteSql() });
  const s = r.setler[0];
  assert.equal(s.karar, 'sec');
  assert.match(s.sebep, /motor-farki\(book1,book2,book3,book4\)/);
  assert.equal(s.tahminiSurum, '2.25.10');
  assert.ok(!s.komutlar[0].arg.includes('--ilk'));
});

test('canlı manifest imzası tutmuyor → hata, plan yok', async () => {
  const { ops } = ortam();
  const t = canliTablo('45550');
  t[`${TABAN}/set/45550/manifest.json.sig`] = crypto.sign(null, Buffer.from('baska'), OZEL)
    .toString('base64');
  const r = await oy.kos(oy.argsAyristir(['45550']),
    { ...ops, getir: sahteGetir(t), sql: sahteSql() });
  assert.equal(r.setler[0].karar, 'hata');
  assert.match(r.setler[0].sebep, /doğrulanmadı/);
  assert.equal(r.cikis, 1);
});

test('canlı index android-shim taşımıyor → Nadir listesi, yayın yok', async () => {
  const { ops } = ortam();
  const t = canliTablo('45550', { motorSha: 'e'.repeat(64),
    index: '<html><head><script src="empp-fs-shim.js"></script>' });
  const r = await oy.kos(oy.argsAyristir(['45550', '--uygula']),
    { ...ops, getir: sahteGetir(t), sql: sahteSql(),
      adimKos: async () => assert.fail('donuk sette adım koşmamalı') });
  assert.equal(r.setler[0].karar, 'nadir');
  assert.match(r.setler[0].sebep, /android-donuk-index/);
  assert.equal(r.setler[0].komutlar, undefined);
  assert.deepEqual(r.nadirKarari.map((n) => n.set), ['45550']);
});

test('canlı index android-shim taşıyor → kapı geçer', async () => {
  const { ops } = ortam();
  const t = canliTablo('45550', { motorSha: 'e'.repeat(64),
    index: '<html><head><script src="empp-android-shim.js"></script>' });
  const r = await oy.kos(oy.argsAyristir(['45550']),
    { ...ops, getir: sahteGetir(t), sql: sahteSql() });
  assert.equal(r.setler[0].karar, 'sec');
});

test('ekleme var → Nadir listesi, yayınlanmaz, canlıya gidilmez', async () => {
  const { ops, bildirimler } = ortam();
  const getir = sahteGetir({});
  const r = await oy.kos(oy.argsAyristir(['45550', '--uygula']),
    { ...ops, getir, sql: sahteSql({ gecerliKitaplar: KITAPLAR5 }),
      adimKos: async () => assert.fail('nadir sette adım koşmamalı') });
  assert.equal(r.setler[0].karar, 'nadir');
  assert.deepEqual(r.nadirKarari.map((n) => n.set), ['45550']);
  assert.deepEqual(r.nadirKarari[0].bilesim.eklenen, [5]);
  assert.equal(getir.istekler.length, 0);
  assert.equal(bildirimler.length, 1);
  assert.match(bildirimler[0], /G 45550 nadir/);
});

test('kilit doluysa çıkış 75, DB okunmaz, log satırı yazılır', async () => {
  const { ops } = ortam();
  fs.writeFileSync(ops.kilitYolu, JSON.stringify({ pid: 424242, zaman: 'x' }));
  const sql = async () => assert.fail('kilit doluyken DB okunmamalı');
  const r = await oy.kos(oy.argsAyristir(['45550']),
    { ...ops, sql, yasiyorMu: (pid) => pid === 424242 });
  assert.equal(r.cikis, oy.CIKIS_KILIT);
  assert.equal(r.kilitDolu, true);
  assert.equal(logSatirlari(ops.logYolu)[0].olay, 'kilit-dolu');
  // Başkasının kilidi yerinde kalır.
  assert.equal(JSON.parse(fs.readFileSync(ops.kilitYolu, 'utf8')).pid, 424242);
  const m = await oy.main(['45550'], { ...ops, sql, yasiyorMu: () => true });
  assert.equal(m.cikis, 75);
  assert.match(m.metin, /KİLİT DOLU/);
});

test('ölü sahibin kilidi devralınır; koşu sonunda kilit bırakılır', async () => {
  const { ops } = ortam();
  fs.writeFileSync(ops.kilitYolu, JSON.stringify({ pid: 999999, zaman: 'x' }));
  const r = await oy.kos(oy.argsAyristir(['45550']),
    { ...ops, getir: sahteGetir({}), sql: sahteSql(), yasiyorMu: () => false });
  assert.equal(r.cikis, 0);
  assert.equal(fs.existsSync(ops.kilitYolu), false);
});

/* ------------------------------------------------------------------ uygula kipi (sahte adım) */

test('uygula: beyaz liste dışı set atlanır + bildirim (24 sa tekrar etmez)', async () => {
  const { ops, bildirimler } = ortam();
  const ek = { ...ops, getir: sahteGetir({}), sql: sahteSql(),
    adimKos: async () => assert.fail('beyaz liste dışında adım koşmamalı') };
  const r = await oy.kos(oy.argsAyristir(['45550', '--uygula']), ek);
  assert.equal(r.setler[0].karar, 'atla');
  assert.match(r.setler[0].sebep, /beyaz-liste-disi/);
  assert.equal(bildirimler.length, 1);
  await oy.kos(oy.argsAyristir(['45550', '--uygula']), ek);
  assert.equal(bildirimler.length, 1, 'aynı durum 24 saatte bir bildirilir');
});

test('uygula: beyaz listedeki set üç adımla koşar; doğrula yeni sürümle; log kanıtı', async () => {
  const { ops, bildirimler } = ortam();
  const kosulan = [];
  const adimKos = async (arg) => {
    kosulan.push(arg);
    if (arg[0] === 'yayinla') {
      return { kod: 0, stdout: JSON.stringify({ surum: '2.25.8' }), stderr: '' };
    }
    if (arg[0] === 'yukle') {
      return { kod: 0, stdout: JSON.stringify({ yuklenen: ['a', 'b'], cakisma: [],
        dogrula: { gecti: true } }), stderr: '' };
    }
    const ok = { gecti: true, surum: '2.25.8', hatalar: [] };
    return { kod: 0, stdout: JSON.stringify(ok), stderr: '' };
  };
  // 74390 yükleme beyaz listesinde (yukle.js).
  const r = await oy.kos(oy.argsAyristir(['74390', '--uygula']),
    { ...ops, getir: sahteGetir({}), sql: sahteSql({ id: '74390' }), adimKos });
  const s = r.setler[0];
  assert.equal(s.karar, 'yayinlandi');
  assert.deepEqual(kosulan.map((x) => x[0]), ['yayinla', 'yukle', 'dogrula']);
  assert.equal(kosulan[2][kosulan[2].length - 1], '2.25.8');
  const log = logSatirlari(ops.logYolu)[0];
  assert.equal(log.set, '74390');
  assert.equal(log.http, 404);
  assert.equal(log.yeniSurum, '2.25.8');
  assert.equal(log.dogrula, true);
  assert.equal(bildirimler.length, 1);
});

test('uygula: üret adımı düşerse sonrakiler koşmaz, karar hata, çıkış 1', async () => {
  const { ops } = ortam();
  const kosulan = [];
  const adimKos = async (arg) => {
    kosulan.push(arg[0]);
    return { kod: 1, stdout: '', stderr: 'HATA: anahtar zinciri okunamadı' };
  };
  const r = await oy.kos(oy.argsAyristir(['74390', '--uygula']),
    { ...ops, getir: sahteGetir({}), sql: sahteSql({ id: '74390' }), adimKos });
  assert.deepEqual(kosulan, ['yayinla']);
  assert.equal(r.setler[0].karar, 'hata');
  assert.equal(r.cikis, 1);
});

test('DB hatası: koşu hatası log + çıkış 1, kilit bırakılır', async () => {
  const { ops } = ortam();
  const r = await oy.kos(oy.argsAyristir(['45550']), { ...ops, sql: async () => {
    throw new Error('pipeline-sql başarısız (çıkış 255)');
  } });
  assert.equal(r.cikis, 1);
  assert.match(r.hata, /255/);
  assert.equal(fs.existsSync(ops.kilitYolu), false);
});

test('plan komutları yayinla.js ayrıştırıcısından geçer; Android ekleme kapısı ilgisiz', () => {
  const y = require('./yayinla');
  const k = oy.komutlariKur({ setKimligi: '45550', taban: TABAN, cikti: '/x', panel: 25,
    paketSurum: '2.25.7', ilk: false, dizinler: ['book1', 'book2'], motorYolu: '/m.js',
    tahminiSurum: '2.25.9' });
  const [u, yk, d] = k.map((c) => y.argsAyristir(c.arg));
  assert.equal(u.komut, 'yayinla');
  assert.deepEqual(u.motorlar, { book1: '/m.js', book2: '/m.js' });
  assert.equal(u.anahtarZinciri, true);
  assert.equal(u.ilk, false);
  assert.deepEqual(y.androidEklemeKapisi(u), []);
  assert.equal(yk.komut, 'yukle');
  assert.equal(yk.onayli, true);
  assert.equal(d.komut, 'dogrula');
  assert.equal(d.uzak, TABAN);
  assert.equal(d.surum, '2.25.9');
});

test('main: argüman hatası çıkış 2; --json geçerli JSON', async () => {
  assert.equal((await oy.main([])).cikis, 2);
  const { ops } = ortam();
  const m = await oy.main(['45550', '--json'], { ...ops, getir: sahteGetir({}), sql: sahteSql() });
  assert.equal(JSON.parse(m.metin).setler[0].karar, 'sec');
});
