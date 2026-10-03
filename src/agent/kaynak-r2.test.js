'use strict';

/**
 * kaynak-r2.js (exe'siz kaynak Dalga B / B4) — saf kararlar + uç istemcisi + r2-kur yayın akışı.
 * Uçtan uca processJob: runner-kaynak-r2.test.js. Arşiv önbelleği: kaynak-arsivi-r2.test.js.
 */

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { izoleOrtam } = require('./test-yalitim');
const YALITIM = izoleOrtam();
const runner = require('./runner.js');

YALITIM.configUygula(runner.CONFIG);
after(() => YALITIM.temizle());

const R = require('./kaynak-r2');
const { parseNextJob } = require('./runner-helpers');
const { kaynakKarari, arsivOkunurMu, manuelKaynakUrl } = require('./kaynak-karari');

const FIKSTUR = path.join(__dirname, 'fixtures', 'claim-kaynak-ornekleri.json');
const KAYNAK_MD = path.join(__dirname, 'fixtures', 'KAYNAK.md');
const ORNEKLER = JSON.parse(fs.readFileSync(FIKSTUR, 'utf8')).ornekler;
const ornek = (ad) => ORNEKLER.find((o) => o.ad === ad).claim;

// ---------------------------------------------------------------------------
// Fikstür eşliği — kopya JSON book-update'teki dosyanın BİREBİR kopyası
// ---------------------------------------------------------------------------

test('fikstür eşliği: kopya JSON\'un sha256\'sı KAYNAK.md\'deki kaynak sha ile aynı', () => {
  const sha = crypto.createHash('sha256').update(fs.readFileSync(FIKSTUR)).digest('hex');
  const m = /sha256:\s*([0-9a-f]{64})/.exec(fs.readFileSync(KAYNAK_MD, 'utf8'));
  assert.ok(m, 'KAYNAK.md sha256 satırı');
  assert.equal(sha, m[1], 'fikstür elle değiştirilmiş ya da kaynak güncellenip sha yazılmamış');
});

test('fikstür: dört tür de hem geçerli hem geçersiz örnekle temsil ediliyor', () => {
  for (const tur of R.KAYNAK_TURLERI) {
    assert.ok(ORNEKLER.some((o) => o.kaynakTuru === tur && o.gecerli), `${tur} geçerli örnek`);
    assert.ok(ORNEKLER.some((o) => o.kaynakTuru === tur && !o.gecerli), `${tur} geçersiz örnek`);
  }
});

for (const o of ORNEKLER) {
  test(`claimKaynakDogrula ↔ zod: "${o.ad}" → ${o.gecerli ? 'KABUL' : 'RET'}`, () => {
    const d = R.claimKaynakDogrula(o.claim);
    assert.equal(d.gecerli, o.gecerli, d.neden || '');
  });
}

for (const o of ORNEKLER.filter((x) => x.kaynakTuru === 'r2-kur' || x.kaynakTuru === 'r2-al')) {
  test(`parseNextJob: "${o.ad}" → ${o.gecerli ? 'alanlar taşınır, kaynakGecersiz yok' : 'kaynakGecersiz + karar gecersiz'}`, () => {
    const job = parseNextJob(200, o.claim);
    assert.ok(job, 'iş düşürülmez (sunucu kiraladı)');
    assert.equal(job.kaynakTuru, o.kaynakTuru);
    const karar = kaynakKarari({ job, arsiv: { zip: '/yok/arsiv.zip', md5: 'x'.repeat(32) } });
    if (o.gecerli) {
      assert.equal(job.kaynakGecersiz, undefined);
      assert.equal(job.kaynakSurumu, o.claim.kaynakSurumu);
      for (const k of ['kaynakUrl', 'kaynakSha256', 'kaynakBoyut', 'tabanUrl', 'tabanSha256', 'kurulumBitis']) {
        assert.equal(job[k], o.claim[k], k);
      }
      assert.equal(karar.tur, o.kaynakTuru);
    } else {
      assert.equal(typeof job.kaynakGecersiz, 'string');
      assert.equal(karar.tur, 'gecersiz');
      assert.equal(karar.url, undefined, 'gecersiz kararda indirilecek adres yok');
    }
  });
}

test('parseNextJob: r2 dallarında downloadUrl BEKLENMEZ; eski türlere r2 alanı eklenmez', () => {
  const j = parseNextJob(200, ornek('r2-kur — tabansız ilk kurulum'));
  assert.equal(j.downloadUrl, '');
  assert.equal(j.kurulumBitis, '2026-10-02T03:00:00.000Z');
  const m = parseNextJob(200, ornek('manuel — /kaynak/ R2 adresi'));
  assert.equal(m.kaynakSurumu, undefined);
  assert.equal(m.kaynakGecersiz, undefined);
});

// ---------------------------------------------------------------------------
// Karar tablosu (4 tür)
// ---------------------------------------------------------------------------

test('karar tablosu: manuel / arsiv-gerekli / r2-kur / r2-al', () => {
  const arsiv = { zip: '/a/build.zip', md5: 'a'.repeat(32) };
  const man = kaynakKarari({ job: parseNextJob(200, ornek('manuel — /kaynak/ R2 adresi')), arsiv });
  assert.deepEqual([man.tur, man.merdiven, man.setEki], ['manuel', false, false]);
  const ars = kaynakKarari({ job: parseNextJob(200, ornek('arsiv-gerekli — yalnız bilgiUrl')), arsiv });
  assert.deepEqual([ars.tur, ars.merdiven, ars.setEki], ['arsiv', true, true]);
  const al = kaynakKarari({ job: parseNextJob(200, ornek('r2-al — virtual-hosted imzalı GET')), arsiv });
  assert.deepEqual([al.tur, al.merdiven, al.setEki, al.surum, al.boyut], ['r2-al', false, false, '2.51.10', 1834567890]);
  const kurA = kaynakKarari({ job: parseNextJob(200, ornek('r2-kur — tabansız ilk kurulum')), arsiv });
  assert.deepEqual([kurA.tur, kurA.taban.tur, kurA.merdiven, kurA.setEki], ['r2-kur', 'arsiv', true, true]);
  const kurR = kaynakKarari({ job: parseNextJob(200, ornek('r2-kur — önceki geçerli build taban')), arsiv });
  assert.equal(kurR.taban.tur, 'r2', 'tabanUrl arşivden önce gelir');
  const kurYok = kaynakKarari({ job: parseNextJob(200, ornek('r2-kur — tabansız ilk kurulum')), arsiv: null });
  assert.deepEqual([kurYok.tur, kurYok.r2Kur], ['yok', true]);
});

test('karar: r2 türünde /kaynak/ downloadUrl\'i olsa bile MANUEL sayılmaz; arşiv okuma kuralı', () => {
  const job = { kaynakTuru: 'r2-al', downloadUrl: 'https://cdn.x/kaynak/1/2.1.1/build.zip', kaynakSurumu: '2.1.1' };
  assert.notEqual(kaynakKarari({ job }).tur, 'manuel');
  assert.equal(manuelKaynakUrl(job), null, 'r2 türünde downloadUrl manuel adres değildir');
  assert.equal(arsivOkunurMu({ ...job, kaynakTuru: 'r2-kur' }), true, 'r2-kur tabanı için arşiv okunur');
  assert.equal(arsivOkunurMu({ kaynakTuru: 'r2-al' }), false);
  assert.equal(arsivOkunurMu({ kaynakTuru: 'r2-kur', tabanUrl: 'https://x' }), false);
  assert.equal(arsivOkunurMu({ kaynakTuru: 'r2-kur' }), true);
  assert.equal(arsivOkunurMu({ kaynakTuru: 'arsiv-gerekli' }), true);
  assert.equal(arsivOkunurMu({ kaynakTuru: 'manuel', downloadUrl: 'https://x/sources/1/a.zip' }), false);
});

// ---------------------------------------------------------------------------
// Yetenek: kaynak-kur yalnız yüksek bantta
// ---------------------------------------------------------------------------

test('kaynakKurEkle: evde bildirilmez, ofiste ya da bayrakla bildirilir, acil kapatma keser', () => {
  assert.deepEqual(R.kaynakKurEkle(['android'], { ofiste: false, serbest: false }), ['android']);
  assert.deepEqual(R.kaynakKurEkle(['android'], { ofiste: true }), ['android', 'kaynak-kur']);
  assert.deepEqual(R.kaynakKurEkle(['android'], { serbest: true }), ['android', 'kaynak-kur']);
  assert.deepEqual(R.kaynakKurEkle(['android'], { acik: false, ofiste: true, serbest: true }), ['android']);
  const g = ['android', 'kaynak-kur'];
  assert.deepEqual(R.kaynakKurEkle(g, { ofiste: false }), ['android'], 'eski liste düzeltilir');
  assert.deepEqual(g, ['android', 'kaynak-kur'], 'girdi değişmez');
});

test('guncelYetenekler: evde kaynak-kur YOK; bayrak dosyasıyla VAR; ofiste VAR', () => {
  const C = runner.CONFIG;
  const eski = { caps: C.caps, kaynakKur: C.kaynakKur, bayrak: C.kaynakKurSerbestFlag };
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kaynak-kur-'));
  try {
    C.caps = ['android'];
    C.kaynakKur = true;
    C.kaynakKurSerbestFlag = path.join(d, 'kaynak-kur-serbest.istek');
    runner._konumAyarla(false);
    assert.deepEqual(runner.guncelYetenekler(), ['android', 'kaynak-r2'], 'evde bildirilmez');
    fs.writeFileSync(C.kaynakKurSerbestFlag, '');
    runner._konumAyarla(false);
    assert.deepEqual(runner.guncelYetenekler(), ['android', 'kaynak-r2', 'kaynak-kur'], 'bayrakla bildirilir');
    fs.rmSync(C.kaynakKurSerbestFlag);
    runner._konumAyarla(true);
    assert.deepEqual(runner.guncelYetenekler(), ['android', 'kaynak-r2', 'kaynak-kur'], 'ofiste bildirilir');
    C.kaynakKur = false;
    runner._konumAyarla(true);
    assert.deepEqual(runner.guncelYetenekler(), ['android', 'kaynak-r2'], 'EMPP_KAYNAK_KUR=0 acil kapatma');
  } finally {
    Object.assign(C, { caps: eski.caps, kaynakKur: eski.kaynakKur, kaynakKurSerbestFlag: eski.bayrak });
    runner._konumAyarla(false);
  }
});

// ---------------------------------------------------------------------------
// Merdiven kanıtı + tamamla gövdesi + özet doğrulama
// ---------------------------------------------------------------------------

test('merdivenKaniti: yalnız ölçülmüş (GUNCEL/GERIDE) sürümler; set eki eklenenleri dahil', () => {
  const k = R.merdivenKaniti({
    merdiven: { satirlar: [
      { kitap: 'book1', id: '111', durum: 'GUNCEL', vs: 7 },
      { kitap: 'book2', id: '222', durum: 'GERIDE', vs: 9 },
      { kitap: 'book3', id: '0', durum: 'ATLANDI' },
      { kitap: 'book4', id: '444', durum: 'OLCULEMEDI', vs: null },
    ] },
    setEki: { eklenen: [{ dizin: 'book5', id: '555', vs: 3 }] },
  });
  assert.deepEqual(k.vsler, { 1: 7, 2: 9, 5: 3 });
  assert.deepEqual(k.icerikSurumleri, [{ id: '111', vs: 7 }, { id: '222', vs: 9 }, { id: '555', vs: 3 }]);
  assert.deepEqual(R.merdivenKaniti({ merdiven: { satirlar: [{ kitap: '.', id: '9', durum: 'GUNCEL', vs: 2 }] } }).vsler,
    { 1: 2 }, 'tek kitap (kök) n=1');
  assert.deepEqual(R.merdivenKaniti({}), { vsler: {}, icerikSurumleri: [] });
});

test('tamamlaKitaplari: vs/id yoksa null (B1 kitapKanitiSemasi nullable, zorunlu anahtar)', () => {
  assert.deepEqual(R.tamamlaKitaplari([{ n: 1, id: '111', vs: 7, icerik: true, kapak: true }, { n: 2, id: null, icerik: false, kapak: true }]),
    [{ n: 1, id: '111', vs: 7, icerik: true, kapak: true }, { n: 2, id: null, vs: null, icerik: false, kapak: true }]);
});

test('r2OzetDogrula: sha uyuşmazlığı ve boyut farkı KALICI ret', () => {
  const sha = 'a'.repeat(64);
  assert.equal(R.r2OzetDogrula({ sha256: sha, boyut: 10 }, { sha256: sha, boyut: 10 }), true);
  assert.throws(() => R.r2OzetDogrula({ sha256: 'b'.repeat(64), boyut: 10 }, { sha256: sha, boyut: 10 }),
    (e) => e instanceof R.KaynakR2Hatasi && e.gecici === false && /sha256 tutmuyor/.test(e.message));
  assert.throws(() => R.r2OzetDogrula({ sha256: sha, boyut: 11 }, { sha256: sha, boyut: 10 }), /boyutu tutmuyor/);
  assert.equal(R.r2OzetDogrula({ sha256: sha, boyut: 11 }, { sha256: sha }), true, 'taban: boyut bilinmez');
  const { isTransientNetworkError, ertelenebilirKaynakHatasi } = require('./runner-helpers');
  const e = new R.KaynakR2Hatasi('build sha256 tutmuyor (x ≠ y) — kullanılmadı');
  assert.equal(isTransientNetworkError(e), false, 'kalıcı hata ağ hatası sayılmamalı (failed yazılır)');
  assert.equal(ertelenebilirKaynakHatasi(e), false);
});

// ---------------------------------------------------------------------------
// Uç istemcisi
// ---------------------------------------------------------------------------

function sahteIstek(yanitlar) {
  const cagrilar = [];
  return {
    cagrilar,
    istek: async (yol, govde) => {
      cagrilar.push({ yol, govde });
      const s = yanitlar[yol];
      const y = Array.isArray(s) ? (s.length > 1 ? s.shift() : s[0]) : s;
      if (y instanceof Error) throw y;
      return y || { status: 404, data: {} };
    },
  };
}

test('istemci: tamamla 200 / 409 nedenler / 409 nedensiz geçici / 5xx tekrarlar sonra geçici / 400 kalıcı', async () => {
  const yap = (y) => {
    const s = sahteIstek({ 'kaynak/tamamla': y });
    return { s, i: R.kaynakUcIstemcisi({ istek: s.istek, sleep: async () => {}, deneme: 3, bekleMs: 0 }) };
  };
  let { i } = yap({ status: 200, data: { ok: true } });
  assert.deepEqual(await i.tamamla({}), { durum: 'tamam', veri: { ok: true } });
  ({ i } = yap({ status: 409, data: { nedenler: ['kitap sayısı 3 ≠ 4'], nedenKodlari: ['kitap-sayisi'] } }));
  assert.deepEqual(await i.tamamla({}), { durum: 'red', nedenler: ['kitap sayısı 3 ≠ 4'], nedenKodlari: ['kitap-sayisi'] });
  ({ i } = yap({ status: 409, data: { nedenler: ['x'] } }));
  assert.deepEqual(await i.tamamla({}), { durum: 'red', nedenler: ['x'], nedenKodlari: [] }, 'kodsuz eski gövde');
  ({ i } = yap({ status: 409, data: { error: 'lease_not_held' } }));
  await assert.rejects(i.tamamla({}), (e) => e.gecici === true);
  let s;
  ({ i, s } = yap([{ status: 502 }, { status: 502 }, { status: 502 }]));
  await assert.rejects(i.tamamla({}), (e) => e.gecici === true && /HTTP 502/.test(e.message));
  assert.equal(s.cagrilar.length, 3, '5xx deneme sayısı kadar');
  ({ i, s } = yap([new Error('ECONNRESET'), { status: 200, data: {} }]));
  assert.equal((await i.tamamla({})).durum, 'tamam', 'ağ hatası sonrası ikinci deneme');
  ({ i } = yap({ status: 400, data: { error: 'sema' } }));
  await assert.rejects(i.tamamla({}), (e) => e.gecici === false);
});

test('istemci: birak FIRLATMAZ; uploadId varsa gövdeye girer', async () => {
  const s = sahteIstek({ 'kaynak/birak': { status: 500 } });
  const i = R.kaynakUcIstemcisi({ istek: s.istek, sleep: async () => {}, deneme: 2, bekleMs: 0 });
  assert.equal(await i.birak({ bookId: '1', platform: 'mac', surum: '2.1.1', sebep: 'x', uploadId: 'u' }), false);
  assert.deepEqual(s.cagrilar[0].govde, { bookId: '1', platform: 'mac', surum: '2.1.1', sebep: 'x', uploadId: 'u' });
});

// ---------------------------------------------------------------------------
// r2KurYayinla — kapı → presign → yükle → tamamla
// ---------------------------------------------------------------------------

const JOB = { bookId: '45549', platform: 'mac', kaynakSurumu: '2.51.10', kurulumBitis: '2099-01-01T00:00:00Z' };
const SHA = 'c'.repeat(64);

function akis({ kapi = { gecti: true, kitaplar: [{ n: 1, id: '111', vs: 7, icerik: true, kapak: true }], nedenler: [] },
  tamamla = { status: 200, data: {} }, presign = null, yukle = null } = {}) {
  const s = sahteIstek({
    'kaynak/presign-multipart': presign || { status: 200, data: { uploadId: 'U1', r2ObjectKey: 'kaynak/45549/2.51.10/build.zip', urls: [{ partNumber: 1, url: 'https://r2/p1' }] } },
    'kaynak/tamamla': tamamla,
    'kaynak/birak': { status: 200, data: {} },
  });
  const sayac = { kapi: 0, yukle: 0 };
  const o = {
    job: JOB, zipYolu: '/is/build.zip', setListesi: '111 | Kitap', oncekiBoyut: 100, vsler: { 1: 7 },
    istemci: R.kaynakUcIstemcisi({ istek: s.istek, sleep: async () => {}, deneme: 2, bekleMs: 0 }),
    kapi: (g) => { sayac.kapi += 1; sayac.kapiGirdi = g; return kapi; },
    ozet: async () => ({ sha256: SHA, md5: 'd'.repeat(32), boyut: 150 }),
    parcalariYukle: async (...a) => { sayac.yukle += 1; sayac.yukleGirdi = a; if (yukle) throw yukle; return [{ partNumber: 1, etag: '"e1"' }]; },
  };
  return { s, sayac, o, yollar: () => s.cagrilar.map((c) => c.yol) };
}

test('r2KurYayinla 200: tamamla gövdesi {surum, sha256, boyut, kitaplar(vs merdivenden), uploadId, parts}; birak YOK', async () => {
  const a = akis();
  const r = await R.r2KurYayinla(a.o);
  assert.equal(r.sha256, SHA);
  assert.deepEqual(a.yollar(), ['kaynak/presign-multipart', 'kaynak/tamamla']);
  assert.deepEqual(a.s.cagrilar[0].govde, { bookId: '45549', platform: 'mac', surum: '2.51.10', partCount: 1 });
  assert.deepEqual(a.s.cagrilar[1].govde, {
    bookId: '45549', platform: 'mac', surum: '2.51.10', sha256: SHA, boyut: 150,
    kitaplar: [{ n: 1, id: '111', vs: 7, icerik: true, kapak: true }],
    uploadId: 'U1', r2ObjectKey: 'kaynak/45549/2.51.10/build.zip', parts: [{ partNumber: 1, etag: '"e1"' }],
  });
  assert.deepEqual(a.sayac.kapiGirdi, { zipYolu: '/is/build.zip', setListesi: '111 | Kitap', oncekiBoyut: 100, oncekiEnvanter: null, tur: 'otomatik', vsler: { 1: 7 } });
});

test('r2KurYayinla 45550: kapının webzVarliklari\'ı tamamla gövdesine ayrı alanda gider (kitaplar\'a karışmaz); notlar loglanır', async () => {
  const webz = [{ n: 5, id: '66903', yol: 'config', icerik: true, kapak: true }];
  const a = akis({ kapi: {
    gecti: true, kitaplar: [{ n: 1, id: '111', vs: 7, icerik: true, kapak: true }], webzVarliklari: webz,
    nedenler: [], notlar: ['Web-Z varlığı kabul: book5 ← liste 66903 (menü assetId; dizin Grade-6-Games)'],
  } });
  const loglar = [];
  await R.r2KurYayinla({ ...a.o, log: (s) => loglar.push(s) });
  const g = a.s.cagrilar[1].govde;
  assert.deepEqual(g.kitaplar, [{ n: 1, id: '111', vs: 7, icerik: true, kapak: true }]);
  assert.deepEqual(g.webzVarliklari, webz);
  assert.ok(loglar.some((s) => /yazma kapısı notları 45549 2\.51\.10: Web-Z varlığı kabul: book5/.test(s)), loglar.join('\n'));
  // Boş liste gönderilmez (eski gövde birebir — üstteki 200 testi).
  const b = akis({ kapi: { gecti: true, kitaplar: [{ n: 1, id: '111', icerik: true, kapak: true }], webzVarliklari: [], nedenler: [] } });
  await R.r2KurYayinla(b.o);
  assert.equal('webzVarliklari' in b.s.cagrilar[1].govde, false);
});

test('tamamlaWebzVarliklari: alanları normalize eder, geçersiz satırı düşürür', () => {
  assert.deepEqual(R.tamamlaWebzVarliklari([
    { n: 5, id: 66903, yol: 'config', icerik: true, kapak: 1 },
    { n: 2, id: '66905', yol: 'ad', icerik: false },
    { n: 0, id: '1' }, { n: 3, id: '' }, null,
  ]), [
    { n: 5, id: '66903', yol: 'config', icerik: true, kapak: false },
    { n: 2, id: '66905', yol: 'ad', icerik: false, kapak: false },
  ]);
  assert.deepEqual(R.tamamlaWebzVarliklari(undefined), []);
});

test('r2KurYayinla kapı reddi: yükleme HİÇ başlamaz (presign yok), birak çağrılır, KALICI hata', async () => {
  const a = akis({ kapi: { gecti: false, kitaplar: [], nedenler: ['[yazma-kapisi] kitap sayısı 1 ≠ liste 2'] } });
  await assert.rejects(R.r2KurYayinla(a.o), (e) => e.gecici === false && /yazma kapısı RED/.test(e.message)
    && e.nedenler.length === 1);
  assert.deepEqual(a.yollar(), ['kaynak/birak']);
  assert.equal(a.sayac.yukle, 0);
  assert.deepEqual(a.s.cagrilar[0].govde, {
    bookId: '45549', platform: 'mac', surum: '2.51.10', sebep: 'kapi-reddi',
    nedenler: ['[yazma-kapisi] kitap sayısı 1 ≠ liste 2'], nedenKodlari: [],
  });
});

test('r2KurYayinla yerel kapı reddi: birak {sebep:kapi-reddi, nedenler, nedenKodlari} gövdesiyle gider', async () => {
  const nedenler = ['[yazma-kapisi] kitap-eksik: liste kimliği 103 build\'de yok', '[yazma-kapisi] book2: kapak yok'];
  const a = akis({ kapi: { gecti: false, kitaplar: [], nedenler, nedenKodlari: ['kitap-eksik', 'kapak-yok'] } });
  await assert.rejects(R.r2KurYayinla(a.o), (e) => e.gecici === false);
  assert.deepEqual(a.yollar(), ['kaynak/birak']);
  assert.deepEqual(a.s.cagrilar[0].govde, {
    bookId: '45549', platform: 'mac', surum: '2.51.10', sebep: 'kapi-reddi', nedenler, nedenKodlari: ['kitap-eksik', 'kapak-yok'],
  });
});

test('r2KurYayinla 409 nedenler (sunucu kapısı): KALICI hata, birak YOK — sunucu kilidi aynı istekte bıraktı', async () => {
  // Saha 02.10 (59480): sunucu kapı reddinde kilidi bırakıp reddi yazar; ikinci birak 409 kilit_yok
  // döndü ve runner "kilit kurulumBitis'te düşer" diye yanlış uyardı.
  const a = akis({ tamamla: { status: 409, data: { nedenler: ['boyut 150 < önceki 1000 × 0.8'] } } });
  await assert.rejects(R.r2KurYayinla(a.o), (e) => e.gecici === false && /sunucu kapısı RED \(HTTP 409\)/.test(e.message));
  assert.deepEqual(a.yollar(), ['kaynak/presign-multipart', 'kaynak/tamamla']);
  // 409 NEDENSİZ (kilit_yok/lease) tamamla ise geçicidir ve birak denenir (eski davranış).
  const b = akis({ tamamla: { status: 409, data: { error: 'kilit_yok' } } });
  await assert.rejects(R.r2KurYayinla(b.o), (e) => e.gecici === true);
  assert.deepEqual(b.yollar(), ['kaynak/presign-multipart', 'kaynak/tamamla', 'kaynak/birak']);
});

test('r2KurYayinla: üretecin link kartları webzVarliklari (yol link) olarak tamamla\'ya gider; kapınınkiyle tekilleşir', async () => {
  const a = akis();
  a.o.ekWebzVarliklari = [{ n: 3, id: '3100010', yol: 'link', icerik: false, kapak: false },
    { n: 0, id: 'x', yol: 'link' }, { n: 4, id: '', yol: 'link' }];
  await R.r2KurYayinla(a.o);
  const t = a.s.cagrilar.find((c) => c.yol === 'kaynak/tamamla').govde;
  assert.deepEqual(t.webzVarliklari, [{ n: 3, id: '3100010', yol: 'link', icerik: false, kapak: false }]);
  assert.deepEqual(R.tamamlaWebzVarliklari([{ n: 2, id: '7', yol: 'link' }, { n: 3, id: '8', yol: 'xx' }]).map((w) => w.yol),
    ['link', 'config']);
});

test('r2KurYayinla ağ hatası (parça) / tamamla 5xx / kilit süresi: GEÇİCİ + birak', async () => {
  let a = akis({ yukle: new Error('part 3 could not be uploaded') });
  await assert.rejects(R.r2KurYayinla(a.o), (e) => e.gecici === true);
  assert.deepEqual(a.yollar(), ['kaynak/presign-multipart', 'kaynak/birak']);
  a = akis({ tamamla: { status: 503 } });
  await assert.rejects(R.r2KurYayinla(a.o), (e) => e.gecici === true);
  assert.equal(a.yollar().at(-1), 'kaynak/birak');
  a = akis();
  a.o.job = { ...JOB, kurulumBitis: '2000-01-01T00:00:00Z' };
  await assert.rejects(R.r2KurYayinla(a.o), (e) => e.gecici === true && /kilidi süresi doldu/.test(e.message));
  assert.deepEqual(a.yollar(), ['kaynak/birak'], 'süre dolmuşsa yükleme başlamaz');
  a = akis({ presign: { status: 409, data: { error: 'kilit' } } });
  await assert.rejects(R.r2KurYayinla(a.o), (e) => e.gecici === true);
});

test('istemci: birak 409 (B2 kilidi kapı reddinde zaten bıraktı) → uyarı, hata DEĞİL, tekrar denenmez', async () => {
  const s = sahteIstek({ 'kaynak/birak': { status: 409, data: { error: 'kilit_yok' } } });
  const uyarilar = [];
  const i = R.kaynakUcIstemcisi({ istek: s.istek, sleep: async () => {}, warn: (m) => uyarilar.push(m), deneme: 3, bekleMs: 0 });
  assert.equal(await i.birak({ bookId: '1', platform: 'mac', surum: '2.1.1', sebep: 'x' }), false);
  assert.equal(s.cagrilar.length, 1);
  assert.match(uyarilar.join('\n'), /kaynak\/birak HTTP 409/);
});

test('r2KurYayinla: kapı reddinde birak 409 dönse de hata KAPI hatasıdır (birak hatası değil)', async () => {
  const a = akis({ kapi: { gecti: false, kitaplar: [], nedenler: ['[yazma-kapisi] kapak yok'] } });
  const s409 = sahteIstek({ 'kaynak/birak': { status: 409, data: {} } });
  a.o.istemci = R.kaynakUcIstemcisi({ istek: s409.istek, sleep: async () => {}, deneme: 2, bekleMs: 0 });
  await assert.rejects(R.r2KurYayinla(a.o), (e) => e.gecici === false && /yazma kapısı RED.*kapak yok/.test(e.message));
  assert.deepEqual(s409.cagrilar.map((c) => c.yol), ['kaynak/birak']);
});

test('r2KurYayinla 409: nedenKodlari hata metninde (bildirim) ve hata nesnesinde', async () => {
  const a = akis({ tamamla: { status: 409, data: { nedenler: ['boyut düşük'], nedenKodlari: ['boyut-esigi', 'kapak-yok'] } } });
  await assert.rejects(R.r2KurYayinla(a.o), (e) => /RED \(HTTP 409\) \[boyut-esigi, kapak-yok\]/.test(e.message)
    && e.nedenKodlari.length === 2);
});

test('kaynak-r2 yeteneği HER ZAMAN bildirilir — evde de ofiste de, kaynak-kur kapalıyken de (inceleme E1)', () => {
  assert.deepEqual(R.kaynakR2Ekle(['android']), ['android', 'kaynak-r2']);
  assert.deepEqual(R.kaynakR2Ekle(['android', 'kaynak-r2']), ['android', 'kaynak-r2'], 'tekrar eklenmez');
  assert.deepEqual(R.kaynakR2Ekle([]), ['kaynak-r2']);
  const C = runner.CONFIG;
  const eski = { caps: C.caps, kaynakKur: C.kaynakKur, bayrak: C.kaynakKurSerbestFlag };
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kaynak-r2-'));
  try {
    C.caps = ['android', 'macos'];
    C.kaynakKurSerbestFlag = path.join(d, 'yok.istek');
    for (const [ofiste, kaynakKur] of [[false, false], [false, true], [true, false], [true, true]]) {
      C.kaynakKur = kaynakKur;
      runner._konumAyarla(ofiste);
      assert.ok(runner.guncelYetenekler().includes('kaynak-r2'), `ofiste=${ofiste} kaynakKur=${kaynakKur}`);
    }
  } finally {
    Object.assign(C, { caps: eski.caps, kaynakKur: eski.kaynakKur, kaynakKurSerbestFlag: eski.bayrak });
    runner._konumAyarla(false);
  }
});

test('r2KurYayinla 03.10: kapı UYARI boyutGerekce verdiyse tamamla gövdesine girer; yoksa girmez', async () => {
  const gerekce = { kod: 'sayfa-tam', kitaplar: [{ kimlik: '5', oncekiSayfa: 248, yeniSayfa: 248, oncekiXmlPage: 248, yeniXmlPage: 248 }] };
  const a = akis({ kapi: {
    gecti: true, kitaplar: [{ n: 1, id: '111', vs: 7, icerik: true, kapak: true }], nedenler: [],
    uyarilar: ['boyut-dustu-sayfa-tam'], boyutGerekce: gerekce,
  } });
  await R.r2KurYayinla(a.o);
  assert.deepEqual(a.s.cagrilar[1].govde.boyutGerekce, gerekce);
  const b = akis();
  await R.r2KurYayinla(b.o);
  assert.equal('boyutGerekce' in b.s.cagrilar[1].govde, false);
});
