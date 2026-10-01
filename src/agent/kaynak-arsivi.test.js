'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  arsivKaynagi, arsivKoku, arsivOzeti, imparkAdiNotu, imparkKaynagiBilgisi,
} = require('./kaynak-arsivi');
const { srcVersionTuret } = require('./runner-helpers');

function kur(icerik = 'zip-icerigi', kayitEk = {}) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'kaynak-arsivi-'));
  const dizin = path.join(kok, '45482');
  fs.mkdirSync(dizin);
  fs.writeFileSync(path.join(dizin, 'build.zip'), icerik);
  const md5 = crypto.createHash('md5').update(icerik).digest('hex');
  const kayit = { dosya: 'build.zip', md5, boyut: Buffer.byteLength(icerik), etiket: 'uretim-masasi-20260925', ...kayitEk };
  fs.writeFileSync(path.join(dizin, 'kaynak.json'), JSON.stringify(kayit));
  return { kok, dizin, md5 };
}

test('kayıt yoksa null — runner İmpark exe yoluna devam eder', async () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'kaynak-arsivi-'));
  assert.equal(await arsivKaynagi(45482, { kok }), null);
});

test('geçerli kayıt: zip yolu, md5 ve arşive özgü srcVersion döner', async () => {
  const { kok, dizin, md5 } = kur();
  const r = await arsivKaynagi(45482, { kok });
  assert.equal(r.zip, path.join(dizin, 'build.zip'));
  assert.equal(r.md5, md5);
  assert.equal(r.srcVersion, `arsiv-${md5.slice(0, 12)}`);
  assert.equal(r.etiket, 'uretim-masasi-20260925');
  assert.ok(fs.existsSync(path.join(dizin, '.md5-dogrulandi')), 'md5 damgası yazılmalı');
});

test('GERİLEME: kayıt var ama zip yoksa HATA — eski kaynağa sessizce düşmez', async () => {
  const { kok, dizin } = kur();
  fs.renameSync(path.join(dizin, 'build.zip'), path.join(dizin, 'baska.zip'));
  await assert.rejects(() => arsivKaynagi(45482, { kok }), /zip yok/);
});

test('boyut tutmuyorsa HATA', async () => {
  const { kok } = kur('abc', { boyut: 999 });
  await assert.rejects(() => arsivKaynagi(45482, { kok }), /boyut tutmuyor/);
});

test('md5 tutmuyorsa HATA ve damga yazılmaz', async () => {
  const { kok, dizin } = kur('abc', { md5: '0'.repeat(32) });
  await assert.rejects(() => arsivKaynagi(45482, { kok }), /md5 tutmuyor/);
  assert.ok(!fs.existsSync(path.join(dizin, '.md5-dogrulandi')));
});

test('dosya alanı yol taşıyamaz (arşiv dışına çıkma yok)', async () => {
  const { kok } = kur('abc', { dosya: '../build.zip' });
  await assert.rejects(() => arsivKaynagi(45482, { kok }), /dosya alanı geçersiz/);
});

test('içerik değişince (aynı boyut, yeni mtime) md5 yeniden hesaplanır', async () => {
  const { kok, dizin } = kur('abc');
  await arsivKaynagi(45482, { kok });
  const zip = path.join(dizin, 'build.zip');
  fs.writeFileSync(zip, 'xyz');
  const ileri = new Date(Date.now() + 5000);
  fs.utimesSync(zip, ileri, ileri);
  await assert.rejects(() => arsivKaynagi(45482, { kok }), /md5 tutmuyor/);
});

test('arsivKoku: EMPP_KAYNAK_ARSIVI önceliklidir', () => {
  assert.equal(arsivKoku({ EMPP_KAYNAK_ARSIVI: '/x/y' }), '/x/y');
  assert.match(arsivKoku({}), /\.empp-agent\/kaynak-arsivi$/);
});

// ---------------------------------------------------------------------------
// İMPARK EXE ADI YALNIZ BİLGİ (Nadir 27.09 — 26.09 "bayat arşiv" ad kapısı KALDIRILDI).
// Ad (İmpark `S_TestKitaplar.Adi`, elle yazılır; aktivasyon/lisans değişikliğinde de artar)
// içerik sürümü değildir: ad farkı işi DÜŞÜRMEZ, tek bilgi satırı yazılır. Güncellik içerik
// merdiveni S0/S1 ve kabul K4/SET_TUM'dan ölçülür. Bütünlük (zip/boyut/md5) denetimleri aynen.
// ---------------------------------------------------------------------------

/** Runner'ın next-job'dan aldığı biçim: köprü anahtarı + her seferinde değişen imza. */
function kopruUrl(ad, imza = 'a1b2c3') {
  return `https://acc.r2.cloudflarestorage.com/akillitahtalar/45482/${ad}`
    + '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=k%2F20260926%2Fauto%2Fs3%2Faws4_request'
    + `&X-Amz-Date=20260926T120000Z&X-Amz-Expires=21600&X-Amz-Signature=${imza}`;
}

const AD_NOTU = 'kaynak arşivi 45482: İmpark exe adı değişti (bilgi) — ShallWe8-v47.exe → '
  + 'ShallWe8-v51.exe; güncellik içerik merdiveninden ölçülür';

test('ad değişti (v47 → v51, 45482 27.09): HATA YOK — arşiv döner, tek bilgi satırı', async () => {
  const { kok, dizin, md5 } = kur('abc', { impark_kaynagi: 'ShallWe8-v47.exe' });
  const notlar = [];
  const r = await arsivKaynagi(45482, {
    kok, imparkKaynagi: srcVersionTuret(kopruUrl('ShallWe8-v51.exe')), bilgi: (m) => notlar.push(m),
  });
  assert.equal(r.md5, md5);
  assert.equal(r.srcVersion, `arsiv-${md5.slice(0, 12)}`);
  assert.deepEqual(r.imparkKaynagi, ['ShallWe8-v47.exe'], 'alan bilgi olarak döner');
  assert.deepEqual(notlar, [AD_NOTU]);
  assert.ok(fs.existsSync(path.join(dizin, '.md5-dogrulandi')), 'md5 denetimi aynen koşmalı');
});

test('ad farkı bütünlük hatasını ÖRTMEZ: boyut/md5 tutmuyorsa yine HATA, not yazılmaz', async () => {
  const { kok, dizin } = kur('abc', { impark_kaynagi: 'ShallWe8-v47.exe' });
  fs.writeFileSync(path.join(dizin, 'build.zip'), 'xyz'); // aynı boyut, farklı içerik
  const notlar = [];
  await assert.rejects(
    () => arsivKaynagi(45482, { kok, imparkKaynagi: 'ShallWe8-v51.exe', bilgi: (m) => notlar.push(m) }),
    /md5 tutmuyor/,
  );
  fs.writeFileSync(path.join(dizin, 'build.zip'), 'abcd');
  await assert.rejects(
    () => arsivKaynagi(45482, { kok, imparkKaynagi: 'ShallWe8-v51.exe', bilgi: (m) => notlar.push(m) }),
    /boyut tutmuyor/,
  );
  assert.deepEqual(notlar, []);
});

test('aynı ad (imza her seferinde farklı): bilgi satırı yok', async () => {
  const { kok, md5 } = kur('abc', { impark_kaynagi: 'ShallWe8-v47.exe' });
  const notlar = [];
  for (const imza of ['imza-1', 'imza-2']) {
    const r = await arsivKaynagi(45482, {
      kok, imparkKaynagi: srcVersionTuret(kopruUrl('ShallWe8-v47.exe', imza)), bilgi: (m) => notlar.push(m),
    });
    assert.equal(r.md5, md5);
  }
  assert.deepEqual(notlar, []);
});

test('geri dönüş, yeniden adlandırma, liste dışı ad: hepsi yalnız bilgi — iş sürer', async () => {
  const cases = [
    ['ShallWe8-v47.exe', 'ShallWe8-v46.exe'],
    ['ShallWe8-v47.exe', 'SW8-26-2.exe'],
    [['MP11-v48.exe', 'MP11-v47.exe'], 'MP11-v49.exe'],
  ];
  for (const [kayitli, guncel] of cases) {
    const { kok, md5 } = kur('abc', { impark_kaynagi: kayitli });
    const notlar = [];
    const r = await arsivKaynagi(45482, { kok, imparkKaynagi: guncel, bilgi: (m) => notlar.push(m) });
    assert.equal(r.md5, md5, guncel);
    assert.equal(notlar.length, 1, guncel);
    assert.match(notlar[0], /İmpark exe adı değişti \(bilgi\) — .* → .*; güncellik içerik merdiveninden ölçülür$/);
  }
});

test('alan yok ya da biçimi bozuk: yalnız bilgi alanı — HATA ve not yok, arşiv döner', async () => {
  for (const alan of [undefined, '', '   ', 47, {}, true, [], ['MP11-v48.exe', ''], ['MP11-v48.exe', 3]]) {
    const { kok, md5 } = kur('abc', alan === undefined ? {} : { impark_kaynagi: alan });
    const notlar = [];
    const r = await arsivKaynagi(45482, { kok, imparkKaynagi: 'ShallWe8-v51.exe', bilgi: (m) => notlar.push(m) });
    assert.equal(r.md5, md5, JSON.stringify(alan));
    assert.equal(r.imparkKaynagi, null, JSON.stringify(alan));
    assert.deepEqual(notlar, [], JSON.stringify(alan));
  }
});

test('çağıran exe kimliği vermez ya da boş verirse: not yok, HATA yok', async () => {
  const { kok } = kur('abc', { impark_kaynagi: 'ShallWe8-v47.exe' });
  for (const imparkKaynagi of [undefined, '', '   ']) {
    const notlar = [];
    const r = await arsivKaynagi(45482, { kok, imparkKaynagi, bilgi: (m) => notlar.push(m) });
    assert.deepEqual(r.imparkKaynagi, ['ShallWe8-v47.exe']);
    assert.deepEqual(notlar, []);
  }
});

test('imparkAdiNotu / imparkKaynagiBilgisi: SAF; tam URL ve liste runner kimliğiyle türetilir', () => {
  const statik = 'https://akillitahta.ydspublishing.com/Uploads/KitapTekExe/45482/ShallWe8-v47.exe';
  assert.deepEqual(imparkKaynagiBilgisi(statik), ['ShallWe8-v47.exe']);
  assert.deepEqual(imparkKaynagiBilgisi(kopruUrl('ShallWe8-v47.exe')), ['ShallWe8-v47.exe']);
  assert.equal(imparkKaynagiBilgisi(''), null);
  assert.equal(imparkKaynagiBilgisi(undefined), null);
  assert.equal(imparkAdiNotu(statik, 'ShallWe8-v47.exe'), null);
  const liste = ['MP11-v48.exe', 'MP11-v47.exe'];
  assert.equal(imparkAdiNotu(liste, 'MP11-v47.exe'), null);
  assert.equal(imparkAdiNotu(liste, 'MP11-v49.exe'),
    'İmpark exe adı değişti (bilgi) — MP11-v48.exe | MP11-v47.exe → MP11-v49.exe; '
    + 'güncellik içerik merdiveninden ölçülür');
  assert.equal(imparkAdiNotu(undefined, 'ShallWe8-v47.exe'), null);
  assert.equal(imparkAdiNotu('ShallWe8-v47.exe', ''), null);
});

// ---------------------------------------------------------------------------
// arsivOzeti (ProBook şeridi iki makinenin arşiv özetini kıyaslar). 27.09'dan beri
// `impark_kaynagi` özete GİRMEZ: yalnız bilgidir, üretimi değiştirmez → ad farkı şeridi
// (ProBook'u duraklatmayı) tetiklemez. Özet = `<id> <md5> <boyut>`.
// ---------------------------------------------------------------------------

function ozetBekle(satir) {
  return crypto.createHash('sha256').update(satir).digest('hex').slice(0, 16);
}

test('arsivOzeti: zip aynıysa impark_kaynagi farkı (ad, liste, yok, bozuk) özeti DEĞİŞTİRMEZ', () => {
  const mac = kur('ayni-zip', { impark_kaynagi: 'ShallWe8-v51.exe' });
  const digerleri = [
    kur('ayni-zip', { impark_kaynagi: 'ShallWe8-v47.exe' }),
    kur('ayni-zip', { impark_kaynagi: ['ShallWe8-v48.exe', 'ShallWe8-v47.exe'] }),
    kur('ayni-zip'),
    kur('ayni-zip', { impark_kaynagi: '' }),
  ];
  const beklenen = ozetBekle(`45482 ${mac.md5} ${Buffer.byteLength('ayni-zip')}`);
  assert.equal(arsivOzeti(mac.kok).ozet, beklenen);
  for (const d of digerleri) assert.equal(arsivOzeti(d.kok).ozet, beklenen);
});

test('arsivOzeti: zip farklıysa özet FARKLI; JSON bozuksa satır BOZUK', () => {
  assert.notEqual(arsivOzeti(kur('zip-a').kok).ozet, arsivOzeti(kur('zip-b').kok).ozet);
  const { kok, dizin } = kur('z');
  fs.writeFileSync(path.join(dizin, 'kaynak.json'), '{bozuk');
  assert.deepEqual(arsivOzeti(kok), { ozet: ozetBekle('45482 BOZUK'), adet: 1, kitaplar: ['45482'] });
});

// ---------------------------------------------------------------------------
// NÖBETÇİ — AD SÜRÜMÜ KARAR DEĞİL (Nadir 27.09: "isim güncellemesi metodu çok kırılgan").
// Depoda TEST DIŞI kodda (src/ scripts/ tools/; *.test.* ve test/fikstür dizinleri hariç, yorumlar
// atılarak) İmpark exe ADI güncellik kararına girmez:
//   A) eski kapının izleri ("arşivi BAYAT", "build zip yeniden üretilmeli", imparkKaynagiKiyasla)
//      ve exe adından sürüm ayrıştırma kalıbı (`-v(\d`, `-v\d`, `-v[0-9]`) hiçbir dosyada yok;
//   B) `impark_kaynagi` / `imparkKaynagi` yalnız kaynak-arsivi.js ve runner.js'te geçer;
//   C) runner.js'te `imparkKaynagi` yalnız arsivKaynagi çağrısında (bilgi için) geçer — dönen
//      `arsiv.imparkKaynagi` hiçbir yerde okunmaz; `impark_kaynagi` hiç geçmez;
//   D) kaynak-arsivi.js'te `impark_kaynagi` yalnız bilgi yardımcılarına argümandır ve o
//      yardımcılar hata fırlatmaz.
// MUTASYON (27.09 elle doğrulandı; her biri bu bölümü kırar): kaynak-arsivi.js'e ad farkında
// `throw new Error('kaynak arşivi BAYAT: …')` (A) · runner.js'e
// `if (!arsiv.imparkKaynagi.includes(imparkSrcVersion)) throw …` (C) · tools/ altındaki bir
// betikte `kayit.impark_kaynagi` okumak (B) · src/ altında `/-v(\d+)\.exe/` ile ad sürümü
// ayrıştırmak (A) · imparkAdiNotu içine `throw` (D).
// ---------------------------------------------------------------------------

const DEPO = path.join(__dirname, '..', '..');
const TARAMA_KOKLERI = ['src', 'scripts', 'tools'];
const ATLA_DIZIN = new Set(['node_modules', 'tests', 'test', '__tests__', 'fixtures', 'fikstur',
  'dist', 'build', 'out']);
const IZINLI = new Set(['src/agent/kaynak-arsivi.js', 'src/agent/runner.js']);

function testDisiKaynaklar() {
  const sonuc = [];
  const yuru = (dizin) => {
    let girdiler;
    try { girdiler = fs.readdirSync(dizin, { withFileTypes: true }); } catch (_) { return; }
    for (const g of girdiler) {
      const tam = path.join(dizin, g.name);
      if (g.isDirectory()) {
        if (!ATLA_DIZIN.has(g.name) && !g.name.startsWith('.')) yuru(tam);
      } else if (g.isFile() && /\.(c|m)?js$|\.ts$|\.sh$|\.py$/.test(g.name)
        && !/\.test\.(c|m)?(js|ts|sh)$/.test(g.name)) {
        sonuc.push(tam);
      }
    }
  };
  for (const k of TARAMA_KOKLERI) yuru(path.join(DEPO, k));
  return sonuc;
}

/** Yorumları atar: JS blok + satır sonu yorumları; sh/py `#` satırları. */
function yorumsuz(metin, dosya) {
  if (/\.(sh|py)$/.test(dosya)) return metin.replace(/^\s*#.*$/gm, '');
  return metin.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

const KAYNAKLAR = testDisiKaynaklar().map((tam) => ({
  goreli: path.relative(DEPO, tam).split(path.sep).join('/'),
  kod: yorumsuz(fs.readFileSync(tam, 'utf8'), tam),
}));

test('nöbetçi: tarama gerçekten depoyu görüyor (boş tarama yeşil vermez)', () => {
  const adlar = new Set(KAYNAKLAR.map((k) => k.goreli));
  for (const zorunlu of [...IZINLI, 'src/agent/icerik-merdiven.js', 'tools/kabul/k4-guncellik.js']) {
    assert.ok(adlar.has(zorunlu), `taranmadı: ${zorunlu}`);
  }
  assert.ok(KAYNAKLAR.length > 100, `yalnız ${KAYNAKLAR.length} dosya tarandı`);
});

test('nöbetçi A: eski ad kapısının izi ve exe adından sürüm ayrıştırma yok', () => {
  const yasak = [
    /arşivi BAYAT/, /build zip yeniden üretilmeli/, /imparkKaynagiKiyasla/,
    /-v\(\\d|-v\\d|-v\[0-9\]/,
  ];
  const ihlal = [];
  for (const { goreli, kod } of KAYNAKLAR) {
    for (const d of yasak) if (d.test(kod)) ihlal.push(`${goreli}: ${d}`);
  }
  assert.deepEqual(ihlal, []);
});

test('nöbetçi B: impark_kaynagi / imparkKaynagi yalnız kaynak-arsivi.js + runner.js', () => {
  const ihlal = KAYNAKLAR
    .filter(({ goreli, kod }) => /impark_kaynagi|imparkKaynagi/.test(kod) && !IZINLI.has(goreli))
    .map(({ goreli }) => goreli);
  assert.deepEqual(ihlal, []);
});

test('nöbetçi C: runner.js exe adını yalnız bilgi için arsivKaynagi\'ye verir, sonucu okumaz', () => {
  const { kod } = KAYNAKLAR.find((k) => k.goreli === 'src/agent/runner.js');
  assert.equal((kod.match(/imparkKaynagi/g) || []).length, 1, 'imparkKaynagi yalnız çağrıda geçmeli');
  // Exe'siz sözleşme (01.10): manuel işte arşiv okunmaz; okunursa exe adı yine YALNIZ bilgi.
  // Dalga B (B4): koşul kaynak-karari `arsivOkunurMu` (manuel + r2-al + tabanUrl'li r2-kur okumaz).
  assert.match(kod,
    /const arsiv = !arsivOkunurMu\(job\) \? null\s*\n\s*: await arsivKaynagi\(job\.bookId, \{ imparkKaynagi: imparkSrcVersion, bilgi: log \}\);/);
  assert.doesNotMatch(kod, /impark_kaynagi/);
});

test('nöbetçi D: kaynak-arsivi.js alanı yalnız bilgi yardımcılarına verir; yardımcılar atmaz', () => {
  const { kod } = KAYNAKLAR.find((k) => k.goreli === 'src/agent/kaynak-arsivi.js');
  const kullanimlar = [...kod.matchAll(/impark_kaynagi/g)];
  assert.ok(kullanimlar.length >= 1);
  for (const m of kullanimlar) {
    const once = kod.slice(Math.max(0, m.index - 40), m.index);
    assert.match(once, /(imparkAdiNotu|imparkKaynagiBilgisi)\(kayit\.$/, `bilgi dışı kullanım: …${once}`);
  }
  for (const fn of ['imparkKaynagiBilgisi', 'imparkAdiNotu']) {
    const bas = kod.indexOf(`function ${fn}(`);
    assert.ok(bas >= 0, fn);
    const govde = kod.slice(bas, kod.indexOf('\n}\n', bas));
    assert.doesNotMatch(govde, /\bthrow\b/, `${fn} karar vermez, hata fırlatmaz`);
  }
  assert.match(kod, /if \(adNotu\) bilgi\(/, 'ad notu yalnız bilgi olarak loglanır');
});
