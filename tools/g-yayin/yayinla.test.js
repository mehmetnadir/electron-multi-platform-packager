'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const y = require('./yayinla');
const anahtar = require('./anahtar');
const { MOTOR_DOSYA_ADI: M } = require('./durum');
const kg = require('../../src/runtime/kitap-guncelleyici');
const { sunucuBaslat } = require('../g-uctan-uca/sunucu');

function ortam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'g-yayin-'));
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const anahtarYolu = path.join(d, 'test.key');
  fs.writeFileSync(anahtarYolu, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
    mode: 0o600,
  });
  const yaz = (g, v) => {
    const p = path.join(d, 'girdi', g);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, v);
    return p;
  };
  const html = (t) =>
    `<!doctype html><html><head><title>${t}</title></head><body>${t}</body></html>`;
  return {
    d,
    anahtarYolu,
    acik: anahtar.acikAnahtarB64(privateKey),
    yaz,
    html,
    cikti: path.join(d, 'senaryolar', 's1'),
  };
}

function temel(o, taban, ek) {
  return {
    komut: 'yayinla',
    setKimligi: '99901',
    taban,
    cikti: o.cikti,
    anahtarDosya: o.anahtarYolu,
    anahtarZinciri: false,
    motorlar: {},
    ekle: {},
    cikar: [],
    ...ek,
  };
}

const sessiz = { gunluk: () => {} };

test('sentinel: kimlik deseni set-kimligi.js ile aynı', () => {
  const kaynak = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'packaging', 'set-kimligi.js'),
    'utf8',
  );
  assert.ok(kaynak.includes(`const KIMLIK_DESENI = ${y.KIMLIK_DESENI.toString()};`));
});

test('argsAyristir: çoklu --motor/--ekle/--cikar, isteğe bağlı --anahtar-dosya, alt komut', () => {
  const a = y.argsAyristir([
    '--set-kimligi',
    '1',
    '--motor',
    'book1=/a.js',
    '--motor',
    'book2=/b.js',
    '--ekle',
    'book4=/k',
    '--cikar',
    'book3,book5',
    '--cikar',
    'book6',
    '--anahtar-dosya',
    '--ilk',
  ]);
  assert.deepEqual(a.motorlar, { book1: '/a.js', book2: '/b.js' });
  assert.deepEqual(a.ekle, { book4: '/k' });
  assert.deepEqual(a.cikar, ['book3', 'book5', 'book6']);
  assert.equal(a.anahtarDosya, true);
  assert.equal(a.ilk, true);
  assert.equal(y.argsAyristir(['kuru-imza']).komut, 'kuru-imza');
  assert.throws(() => y.argsAyristir(['--motor', 'book1']), /bookN=<yol>/);
  assert.throws(() => y.argsAyristir(['sil']), /alt komut/);
  assert.throws(() => y.argsAyristir(['--bilinmeyen']), /bilinmeyen/);
});

test('uçtan uca (http): iki yayın → Windows istemcisi 2.90.1 kurulumunu 2.90.3 yapar', async () => {
  const o = ortam();
  const s = await sunucuBaslat({ dizin: o.d, port: 0, tls: null, gunluk: () => {} });
  try {
    const taban = `http://127.0.0.1:${s.port}/s1/guncelleme`;
    const book4 = path.join(o.d, 'girdi', 'book4');
    o.yaz('book4/index.html', o.html('book4'));
    o.yaz(`book4/${M}`, 'motor-kitap4');
    const r1 = await y.yayinla(
      temel(o, taban, {
        ilk: true,
        oncekiSurum: '2.90.1',
        panel: '90',
        index: o.yaz('i2.html', o.html('v2')),
        motorlar: { book2: o.yaz('m2.js', 'motor-v2') },
        ekle: { book4 },
        cikar: ['book3'],
      }),
      sessiz,
    );
    assert.equal(r1.surum, '2.90.2');
    assert.equal(r1.onceki, '2.90.1');
    const r2 = await y.yayinla(
      temel(o, taban, { panel: 'SM-v90', index: o.yaz('i3.html', o.html('v3')) }),
      sessiz,
    );
    assert.equal(r2.surum, '2.90.3');
    assert.deepEqual(r2.degisenKabuk, ['index.html']);
    assert.equal(r2.kabuk, 2, 'book2 motoru taşındı');
    assert.equal(r2.kitaplar, 2, 'ekle/çıkar kararları taşındı');

    // Yükleme planı: içerik → sürüm arşivi → manifest → surum.json EN SON.
    const plan = JSON.parse(fs.readFileSync(r2.plan, 'utf8'));
    const anahtarlar = plan.yukle.map((p) => p.anahtar);
    assert.equal(anahtarlar[anahtarlar.length - 1], 'guncelleme/set/99901/surum.json');
    assert.ok(
      anahtarlar.indexOf('guncelleme/set/99901/dosya/index.html') <
        anahtarlar.indexOf('guncelleme/set/99901/manifest.json'),
    );
    assert.ok(plan.yukle.every((p) => fs.existsSync(p.yerel)));
    const p1 = JSON.parse(fs.readFileSync(r1.plan, 'utf8'));
    const zipGirdi = p1.yukle.find((p) => p.anahtar.includes('/kitap/book4-'));
    assert.equal(zipGirdi.cacheControl, y.CACHE_DEGISMEZ);
    assert.equal(p1.yukle[0].sira, 1);

    // Kurulu 2.90.1 ağacı → gerçek istemci.
    const kok = path.join(o.d, 'kurulu');
    for (const b of ['book1', 'book2', 'book3']) {
      fs.mkdirSync(path.join(kok, b), { recursive: true });
      fs.writeFileSync(path.join(kok, b, M), 'motor-v1');
      fs.writeFileSync(path.join(kok, b, 'index.html'), b);
    }
    fs.writeFileSync(path.join(kok, 'index.html'), o.html('v1'));
    const set = { setKimligi: '99901', taban, imza: { alg: 'ed25519', acikAnahtar: o.acik } };
    const rapor = await kg.guncellemeyiCalistir({ taban, set, kok });
    assert.equal(rapor.durum, 'guncellendi', JSON.stringify(rapor));
    assert.equal(fs.readFileSync(path.join(kok, 'index.html'), 'utf8'), o.html('v3'));
    assert.equal(fs.readFileSync(path.join(kok, 'book2', M), 'utf8'), 'motor-v2');
    assert.equal(fs.readFileSync(path.join(kok, 'book1', M), 'utf8'), 'motor-v1');
    assert.equal(fs.readFileSync(path.join(kok, 'book4', M), 'utf8'), 'motor-kitap4');
    assert.equal(fs.existsSync(path.join(kok, 'book3')), false);
    const ikinci = await kg.guncellemeyiCalistir({ taban, set, kok });
    assert.equal(ikinci.durum, 'guncel');

    // dogrula alt komutu
    const d = y.ciktiDogrula({ cikti: o.cikti, setKimligi: '99901', acik: o.acik });
    assert.equal(d.gecti, true, d.hatalar.join('; '));
    assert.equal(d.surum, '2.90.3');
    assert.equal(
      y.ciktiDogrula({ cikti: o.cikti, setKimligi: '99901', acik: anahtar.URETIM_ACIK_ANAHTAR })
        .gecti,
      false,
    );

    // Yayın sonrası uzak doğrulama (canlı uç yerine yerel sunucu): indir → imza → sha256.
    const u = await y.uzakDogrula({
      taban,
      setKimligi: '99901',
      acik: o.acik,
      beklenenSurum: '2.90.3',
      arsivler: true,
    });
    assert.equal(u.gecti, true, u.hatalar.join('; '));
    assert.deepEqual([u.surum, u.dosya, u.arsiv], ['2.90.3', 2, 1]);
    const uUretim = await y.uzakDogrula({
      taban,
      setKimligi: '99901',
      acik: anahtar.URETIM_ACIK_ANAHTAR,
    });
    assert.equal(uUretim.gecti, false);
    assert.match(uUretim.hatalar[0], /imza doğrulanmadı/);
    const uEski = await y.uzakDogrula({
      taban,
      setKimligi: '99901',
      acik: o.acik,
      beklenenSurum: '2.90.4',
    });
    assert.match(uEski.hatalar.join(';'), /≠ beklenen 2\.90\.4/);
    const uBaska = await y.uzakDogrula({ taban, setKimligi: '99902', acik: o.acik });
    assert.equal(uBaska.gecti, false);
    fs.writeFileSync(path.join(o.cikti, 'set', '99901', 'dosya', 'index.html'), 'bozuk');
    const uBozuk = await y.uzakDogrula({ taban, setKimligi: '99901', acik: o.acik });
    assert.match(uBozuk.hatalar.join(';'), /dosya\/index\.html sha256/);
    const cli = await y.main([
      'dogrula',
      '--uzak',
      taban,
      '--set-kimligi',
      '99901',
      '--acik-anahtar',
      o.acik,
    ]);
    assert.equal(cli.cikis, 1);
  } finally {
    await s.kapat();
  }
});

test('monotonluk ve ilk yayın kuralları', async () => {
  const o = ortam();
  const taban = 'https://ornek.invalid/guncelleme';
  const idx = o.yaz('i.html', o.html('a'));
  await assert.rejects(
    y.yayinla(temel(o, taban, { panel: 90, index: idx }), sessiz),
    /önceki durum bulunamadı/,
  );
  await assert.rejects(
    y.yayinla(temel(o, taban, { ilk: true, panel: 90, index: idx }), sessiz),
    /--onceki-surum/,
  );
  await assert.rejects(
    y.yayinla(
      temel(o, taban, { ilk: true, oncekiSurum: '2.90.5', surum: '2.90.5', index: idx }),
      sessiz,
    ),
    /monoton değil/,
  );
  await assert.rejects(
    y.yayinla(temel(o, taban, { ilk: true, surum: '2.90.1', panel: 91, index: idx }), sessiz),
    /çelişiyor/,
  );
  const r = await y.yayinla(
    temel(o, taban, { ilk: true, oncekiSurum: '2.90.5', panel: 90, index: idx }),
    sessiz,
  );
  assert.equal(r.surum, '2.90.6');
  await assert.rejects(
    y.yayinla(
      temel(o, taban, {
        ilk: true,
        oncekiSurum: '2.90.5',
        panel: 90,
        index: o.yaz('j.html', o.html('b')),
      }),
      sessiz,
    ),
    /önceki durum var/,
  );
  await assert.rejects(
    y.yayinla(temel(o, taban, { surum: '2.90.6', index: o.yaz('k.html', o.html('c')) }), sessiz),
    /monoton değil/,
  );
  await assert.rejects(
    y.yayinla(temel(o, taban, { panel: 89, index: o.yaz('l.html', o.html('d')) }), sessiz),
    /geri gidiyor/,
  );
  await assert.rejects(
    y.yayinla(temel(o, taban, { panel: 90, index: idx }), sessiz),
    /aynı içerik/,
  );
  const r2 = await y.yayinla(
    temel(o, taban, { panel: 90, oncekiSurum: '2.90.9', index: o.yaz('m.html', o.html('e')) }),
    sessiz,
  );
  assert.equal(r2.surum, '2.90.10', 'kurulu paket sürümü daha büyükse onun üstüne çıkılır');
});

test('önceki durum başka anahtarla imzalıysa taşınmaz; başka setin manifesti RED', async () => {
  const o = ortam();
  const taban = 'https://ornek.invalid/guncelleme';
  await y.yayinla(
    temel(o, taban, {
      ilk: true,
      oncekiSurum: '2.90.1',
      panel: 90,
      index: o.yaz('i.html', o.html('a')),
    }),
    sessiz,
  );
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const baska = path.join(o.d, 'baska.key');
  fs.writeFileSync(baska, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  await assert.rejects(
    y.yayinla(
      {
        ...temel(o, taban, { panel: 90, index: o.yaz('j.html', o.html('b')) }),
        anahtarDosya: baska,
      },
      sessiz,
    ),
    /bu anahtarla doğrulanmadı/,
  );
  const setDizini = path.join(o.cikti, 'set', '99901');
  await assert.rejects(
    y.yayinla(
      {
        ...temel(o, taban, { panel: 90, index: o.yaz('k.html', o.html('c')) }),
        setKimligi: '99902',
        oncekiManifest: path.join(setDizini, 'manifest.json'),
      },
      sessiz,
    ),
    /başka setin/,
  );
});

test('girdi denetimi: https dışı taban, HTML olmayan index, sarmal arşiv, kimlik', async () => {
  const o = ortam();
  const taban = 'https://ornek.invalid/guncelleme';
  const idx = o.yaz('i.html', o.html('a'));
  await assert.rejects(
    y.yayinla(temel(o, 'http://ornek.com/g', { ilk: true, surum: '2.1.1', index: idx }), sessiz),
    /https/,
  );
  await assert.rejects(
    y.yayinla(
      temel(o, taban, { ilk: true, surum: '2.1.1', index: o.yaz('d.js', 'var a;') }),
      sessiz,
    ),
    /HTML/,
  );
  await assert.rejects(
    y.yayinla(
      temel(o, taban, { ilk: true, surum: '2.1.1', motorlar: { book1: o.yaz('bos.js', '') } }),
      sessiz,
    ),
    /boş/,
  );
  await assert.rejects(
    y.yayinla(
      { ...temel(o, taban, { ilk: true, surum: '2.1.1', index: idx }), setKimligi: '../x' },
      sessiz,
    ),
    /set-kimligi/,
  );
  o.yaz('sarmal/book5/index.html', 'x');
  await assert.rejects(
    y.yayinla(
      temel(o, taban, {
        ilk: true,
        surum: '2.1.1',
        ekle: { book5: path.join(o.d, 'girdi', 'sarmal') },
      }),
      sessiz,
    ),
    /sarmal/,
  );
  await assert.rejects(
    y.yayinla(
      temel(o, taban, { ilk: true, surum: '2.1.1', index: idx, anahtarZinciri: true }),
      sessiz,
    ),
    /tam olarak bir/,
  );
});

test('CLI: yayın çıktısında ve hatada özel anahtar baytı yok', async () => {
  const o = ortam();
  const pemMetni = fs.readFileSync(o.anahtarYolu, 'utf8');
  const govdeB64 = pemMetni.split('\n')[1];
  const r = await y.main(
    [
      '--set-kimligi',
      '99901',
      '--taban',
      'https://ornek.invalid/g',
      '--cikti',
      o.cikti,
      '--ilk',
      '--onceki-surum',
      '2.5.1',
      '--panel',
      '5',
      '--index',
      o.yaz('i.html', o.html('a')),
      '--anahtar-dosya',
      o.anahtarYolu,
    ],
    sessiz,
  );
  assert.equal(r.cikis, 0);
  assert.ok(!r.metin.includes(govdeB64));
  const agac = [];
  const tara = (p) => {
    for (const g of fs.readdirSync(p, { withFileTypes: true })) {
      const t = path.join(p, g.name);
      if (g.isDirectory()) tara(t);
      else agac.push(t);
    }
  };
  tara(o.cikti);
  for (const f of agac)
    assert.ok(!fs.readFileSync(f, 'utf8').includes(govdeB64), `anahtar sızdı: ${f}`);
  const d = await y.main([
    'dogrula',
    '--cikti',
    o.cikti,
    '--set-kimligi',
    '99901',
    '--anahtar-dosya',
    o.anahtarYolu,
  ]);
  assert.equal(d.cikis, 0, d.metin);
});
