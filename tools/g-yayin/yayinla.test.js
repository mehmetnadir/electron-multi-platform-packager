'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const y = require('./yayinla');
const anahtar = require('./anahtar');
const durum = require('./durum');
const { MOTOR_DOSYA_ADI: M } = durum;
const zip = require('./zip-yaz');
const kg = require('../../src/runtime/kitap-guncelleyici');
const { MENU_ISARETI } = require('../../src/packaging/set-menu-bicim');
const { sunucuBaslat } = require('../g-uctan-uca/sunucu');

/**
 * `uzakDogrula`'yı ağ olmadan sınamak için: `<taban>/set/<id>/…` isteklerini doğrudan
 * `--cikti` dizininin aynı ağacından okur/indirir (gerçek dosya baytları — sahte değil).
 */
function yerelUzakBaglantisi(cikti, setKimligi, taban) {
  const kok = path.join(path.resolve(cikti), 'set', String(setKimligi));
  const kimlikKoku = `${taban}/set/${encodeURIComponent(setKimligi)}`;
  const cozYol = (adres) => {
    if (!adres.startsWith(kimlikKoku + '/')) return null;
    return path.join(
      kok,
      ...adres
        .slice(kimlikKoku.length + 1)
        .split('/')
        .map(decodeURIComponent),
    );
  };
  const getir = async (adres) => {
    const y2 = cozYol(adres);
    if (!y2 || !fs.existsSync(y2)) return { durum: 404, govde: Buffer.alloc(0) };
    return { durum: 200, govde: fs.readFileSync(y2) };
  };
  const arsiviIndir = async (adres, hedef) => {
    const y2 = cozYol(adres);
    if (!y2 || !fs.existsSync(y2)) return { durum: 404, boyut: 0, ozet: '' };
    const v = fs.readFileSync(y2);
    fs.writeFileSync(hedef, v);
    return { durum: 200, boyut: v.length, ozet: crypto.createHash('sha256').update(v).digest('hex') };
  };
  return { getir, arsiviIndir };
}

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
  // Kök menü (K17 sade biçimi, kartsız): `--ekle`/`--cikar` menüsü tanınan bir kök ister.
  const menu = (t) =>
    `${MENU_ISARETI}\n<!DOCTYPE html>\n<html lang="tr">\n<head><title>${t}</title></head>\n` +
    '<body>\n  <main>\n  </main>\n</body>\n</html>\n';
  return {
    d,
    anahtarYolu,
    acik: anahtar.acikAnahtarB64(privateKey),
    yaz,
    html,
    menu,
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
        index: o.yaz('i2.html', o.menu('v2')),
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

    // Yükleme planı: içerik → sürüm arşivi → manifest → surum.json EN SON (canonical + android).
    const plan = JSON.parse(fs.readFileSync(r2.plan, 'utf8'));
    const anahtarlar = plan.yukle.map((p) => p.anahtar);
    assert.deepEqual(
      anahtarlar.slice(-2).sort(),
      ['guncelleme/set/99901/android/surum.json', 'guncelleme/set/99901/surum.json'],
      'iki surum.json (canonical + android) plan sonunda, TEK imza paylaşılıyor',
    );
    assert.ok(anahtarlar.includes('guncelleme/set/99901/android/manifest.json'));
    assert.ok(anahtarlar.includes('guncelleme/set/99901/android/dosya/index.html'));
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

test('yayinla: ekle girdisine imzalı dosyalar[] listesi eklenir (arşivle birebir, sıralı)', async () => {
  const o = ortam();
  const taban = 'https://ornek.invalid/guncelleme';
  o.yaz('book4/index.html', o.html('book4'));
  o.yaz('book4/sayfa/ölçü.txt', 'ç');
  await y.yayinla(
    temel(o, taban, {
      ilk: true,
      oncekiSurum: '2.63.1',
      panel: 63,
      index: o.yaz('i.html', o.menu('a')),
      ekle: { book4: path.join(o.d, 'girdi', 'book4') },
    }),
    sessiz,
  );
  const setDizini = path.join(o.cikti, 'set', '99901');
  const m = JSON.parse(fs.readFileSync(path.join(setDizini, 'manifest.json'), 'utf8'));
  const b4 = m.kitaplar.find((k) => k.dizin === 'book4');
  assert.ok(Array.isArray(b4.dosyalar) && b4.dosyalar.length === 2);
  assert.ok(b4.dosyalar.every(durum.dosyaGirdisiGecerliMi), 'her girdi biçimsel geçerli');
  assert.deepEqual(
    b4.dosyalar.map((g) => g.yol),
    ['index.html', 'sayfa/ölçü.txt'],
  );
  // Bağımsız olarak arşivden yeniden türetilen liste birebir aynı olmalı.
  const zipAd = fs.readdirSync(path.join(setDizini, 'kitap'))[0];
  const gercek = zip.zipIcerigi(path.join(setDizini, 'kitap', zipAd));
  assert.deepEqual(b4.dosyalar, gercek);
  assert.equal(y.dosyalarKarsilastir(b4.dosyalar, gercek), null);

  const d1 = y.ciktiDogrula({ cikti: o.cikti, setKimligi: '99901', acik: o.acik });
  assert.equal(d1.gecti, true, d1.hatalar.join('; '));
});

test('yayinla: --ekle hazır zip içinde yol kaçışı varsa RED', async () => {
  const o = ortam();
  const taban = 'https://ornek.invalid/guncelleme';
  const zipYolu = path.join(o.d, 'kotu.zip');
  zip.zipYaz(zipYolu, [
    { yol: 'index.html', veri: Buffer.from('<html>book4</html>') },
    { yol: '../kacti.txt', veri: Buffer.from('kacti') },
  ]);
  await assert.rejects(
    y.yayinla(
      temel(o, taban, {
        ilk: true,
        oncekiSurum: '2.64.1',
        panel: 64,
        index: o.yaz('i.html', o.html('a')),
        ekle: { book4: zipYolu },
      }),
      sessiz,
    ),
    /güvensiz yol/,
  );
});

test('eski manifest (dosyalar alanı yok) hâlâ doğrulanır — geriye uyumluluk', async () => {
  const o = ortam();
  const taban = 'https://ornek.invalid/guncelleme';
  o.yaz('book4/index.html', o.html('book4'));
  await y.yayinla(
    temel(o, taban, {
      ilk: true,
      oncekiSurum: '2.65.1',
      panel: 65,
      index: o.yaz('i.html', o.menu('a')),
      ekle: { book4: path.join(o.d, 'girdi', 'book4') },
    }),
    sessiz,
  );
  const setDizini = path.join(o.cikti, 'set', '99901');
  const manifestYolu = path.join(setDizini, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(manifestYolu, 'utf8'));
  const b4 = m.kitaplar.find((k) => k.dizin === 'book4');
  assert.ok(Array.isArray(b4.dosyalar) && b4.dosyalar.length > 0, 'yeni yayın dosyalar üretmeli');
  delete b4.dosyalar; // eski istemci/eski manifest simülasyonu (alan hiç yok)
  const ozel = anahtar.dosyadanOku(o.anahtarYolu);
  const govde = Buffer.from(JSON.stringify(m), 'utf8');
  const imza = anahtar.imzala(govde, ozel, o.acik);
  fs.writeFileSync(manifestYolu, govde);
  fs.writeFileSync(manifestYolu + kg.IMZA_UZANTI, imza);
  // Android mirror'ı da AYNI baytlarla güncelle (TEK imza paylaşılıyor — gerçek bir yayın
  // canonical ve android/ manifestini birlikte yazar, bu yüzden test de ikisini birlikte tutar).
  const androidDizini = path.join(setDizini, 'android');
  fs.writeFileSync(path.join(androidDizini, 'manifest.json'), govde);
  fs.writeFileSync(path.join(androidDizini, 'manifest.json' + kg.IMZA_UZANTI), imza);

  const d1 = y.ciktiDogrula({ cikti: o.cikti, setKimligi: '99901', acik: o.acik });
  assert.equal(d1.gecti, true, d1.hatalar.join('; '));

  const { getir, arsiviIndir } = yerelUzakBaglantisi(o.cikti, '99901', taban);
  const u1 = await y.uzakDogrula({
    taban,
    setKimligi: '99901',
    acik: o.acik,
    arsivler: true,
    getir,
    arsiviIndir,
  });
  assert.equal(u1.gecti, true, u1.hatalar.join('; '));
});

test('dogrula: dosyalar listesi arşivle uyuşmazsa RED (yerel ve uzak)', async () => {
  const o = ortam();
  const taban = 'https://ornek.invalid/guncelleme';
  o.yaz('book4/index.html', o.html('book4'));
  o.yaz('book4/alt.txt', 'ek dosya');
  await y.yayinla(
    temel(o, taban, {
      ilk: true,
      oncekiSurum: '2.66.1',
      panel: 66,
      index: o.yaz('i.html', o.menu('a')),
      ekle: { book4: path.join(o.d, 'girdi', 'book4') },
    }),
    sessiz,
  );
  const setDizini = path.join(o.cikti, 'set', '99901');
  const manifestYolu = path.join(setDizini, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(manifestYolu, 'utf8'));
  const b4 = m.kitaplar.find((k) => k.dizin === 'book4');
  assert.ok(b4.dosyalar.length >= 2);
  // Manifesti KURCALA: listedeki bir dosyanın sha256'sını değiştir (arşiv AYNI kalır) ve
  // AYNI anahtarla yeniden imzala — "yanlış liste imzalanmış/kurcalanmış" senaryosu.
  b4.dosyalar = [{ ...b4.dosyalar[0], sha256: '0'.repeat(64) }, ...b4.dosyalar.slice(1)];
  const ozel = anahtar.dosyadanOku(o.anahtarYolu);
  const govde = Buffer.from(JSON.stringify(m), 'utf8');
  fs.writeFileSync(manifestYolu, govde);
  fs.writeFileSync(manifestYolu + kg.IMZA_UZANTI, anahtar.imzala(govde, ozel, o.acik));

  const yerel = y.ciktiDogrula({ cikti: o.cikti, setKimligi: '99901', acik: o.acik });
  assert.equal(yerel.gecti, false);
  assert.match(yerel.hatalar.join(';'), /dosyalar listesi arşivle uyuşmuyor/);

  const { getir, arsiviIndir } = yerelUzakBaglantisi(o.cikti, '99901', taban);
  const uzak = await y.uzakDogrula({
    taban,
    setKimligi: '99901',
    acik: o.acik,
    arsivler: true,
    getir,
    arsiviIndir,
  });
  assert.equal(uzak.gecti, false);
  assert.match(uzak.hatalar.join(';'), /dosyalar listesi arşivle uyuşmuyor/);
});

test('dosyalarKarsilastir: birim — eksik/fazla/farklı sha256 hepsi yakalanır', () => {
  const a = [
    { yol: 'index.html', sha256: 'a'.repeat(64), boyut: 1 },
    { yol: 'b.txt', sha256: 'b'.repeat(64), boyut: 2 },
  ];
  assert.equal(y.dosyalarKarsilastir(a, a), null);
  assert.match(y.dosyalarKarsilastir(a, [a[0]]), /uyuşmuyor/);
  assert.match(
    y.dosyalarKarsilastir(a, [a[0], { yol: 'baska.txt', sha256: 'c'.repeat(64), boyut: 3 }]),
    /arşivde yok/,
  );
  assert.match(
    y.dosyalarKarsilastir(a, [a[0], { ...a[1], sha256: 'f'.repeat(64) }]),
    /uyuşmuyor/,
  );
});

/* ------------------------------------------------ G ile eklenen kitaba fs-shim (26.09) */

/**
 * NEDEN: G ile EKLENEN kitap paketleme anında pakette yoktu → `bookN/index.html` paketleyicinin
 * alt-kitap fs-shim etiketlerini almamıştı → renderer `fs` okumaları örtüyü (mac/Pardus) ve WORK'ü
 * (Windows) görmüyordu. Etiketler burada DÜZ METİNLE beklenir (paketleyici çıktısıyla aynı biçim);
 * üretim kodu tek kaynağı (`src/packaging/fs-shim-subbook-html.js`) çağırır.
 */
const SHIM_ETIKETLERI =
  '<head><script>window.__emppSubBook="book4";</script>\n' +
  '<script src="../empp-fs-shim.js"></script>';

function arsivOku(o) {
  const setDizini = path.join(o.cikti, 'set', '99901');
  const m = JSON.parse(fs.readFileSync(path.join(setDizini, 'manifest.json'), 'utf8'));
  const b4 = m.kitaplar.find((k) => k.dizin === 'book4');
  const zipYolu = path.join(setDizini, 'kitap', decodeURIComponent(b4.kaynak.split('/kitap/')[1]));
  const girdiler = kg.arsivCozVarsayilan(fs.readFileSync(zipYolu));
  const index = girdiler.find((g) => g.yol === 'index.html').veri.toString('utf8');
  return { setDizini, m, b4, zipYolu, index };
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

async function ekleYayinla(o, kaynak, ek = {}) {
  return y.yayinla(
    temel(o, 'https://ornek.invalid/guncelleme', {
      ilk: true,
      oncekiSurum: '2.65.1',
      panel: 65,
      index: o.yaz('i.html', o.menu('a')),
      ekle: { book4: kaynak },
      ...ek,
    }),
    sessiz,
  );
}

test('fs-shim: dizinden eklenen kitap sayfası enjekte girer; dosyalar[] + dogrula tutarlı', async () => {
  const o = ortam();
  o.yaz('book4/index.html', o.html('book4'));
  o.yaz('book4/sayfa/1.txt', 's1');
  const r = await ekleYayinla(o, path.join(o.d, 'girdi', 'book4'));
  assert.deepEqual(r.fsShim, { book4: 'enjekte' });
  const a = arsivOku(o);
  assert.ok(a.index.includes(SHIM_ETIKETLERI), a.index);
  assert.equal(a.index, o.html('book4').replace('<head>', SHIM_ETIKETLERI));
  // Kaynak dosyaya dokunulmadı (yalnız arşivdeki kopya değişir).
  const kaynakSayfa = fs.readFileSync(path.join(o.d, 'girdi', 'book4', 'index.html'), 'utf8');
  assert.equal(kaynakSayfa, o.html('book4'));
  // İmzalı dosyalar[]: index.html girdisi enjeksiyon SONRASI baytın sha256/boyutu.
  const gi = a.b4.dosyalar.find((g) => g.yol === 'index.html');
  assert.equal(gi.sha256, sha(Buffer.from(a.index, 'utf8')));
  assert.equal(gi.boyut, Buffer.byteLength(a.index, 'utf8'));
  assert.notEqual(gi.sha256, sha(Buffer.from(o.html('book4'), 'utf8')), 'kaynak sha256 DEĞİL');
  assert.deepEqual(a.b4.dosyalar, zip.zipIcerigi(a.zipYolu));
  // Arşiv sha256/boyutu da son (enjekte) arşivin kendisi.
  const v = fs.readFileSync(a.zipYolu);
  assert.equal(a.b4.sha256, sha(v));
  assert.equal(a.b4.boyut, v.length);
  const d = y.ciktiDogrula({ cikti: o.cikti, setKimligi: '99901', acik: o.acik });
  assert.equal(d.gecti, true, d.hatalar.join('; '));
});

test('fs-shim: idempotent — etiketli sayfa bayt bayt aynı kalır, çift etiket yok', async () => {
  const o = ortam();
  const etiketli = o.html('book4').replace('<head>', SHIM_ETIKETLERI);
  o.yaz('book4/index.html', etiketli);
  const r = await ekleYayinla(o, path.join(o.d, 'girdi', 'book4'));
  assert.deepEqual(r.fsShim, { book4: 'zaten-var' });
  const a = arsivOku(o);
  assert.equal(a.index, etiketli);
  assert.equal(a.index.split('empp-fs-shim.js').length - 1, 1);
  assert.equal(a.index.split('__emppSubBook').length - 1, 1);
});

test('fs-shim: hazır zip — etiketsiz yeniden paketlenir, etiketliye dokunulmaz', async () => {
  // (a) etiketsiz zip → enjekte edilmiş yeni arşiv
  const o = ortam();
  const ham = path.join(o.d, 'ham.zip');
  zip.zipYaz(ham, [
    { yol: 'index.html', veri: Buffer.from(o.html('book4')) },
    { yol: 'sayfa/1.txt', veri: Buffer.from('s1') },
  ]);
  const r = await ekleYayinla(o, ham);
  assert.deepEqual(r.fsShim, { book4: 'enjekte' });
  const a = arsivOku(o);
  assert.ok(a.index.includes(SHIM_ETIKETLERI));
  assert.notEqual(a.b4.sha256, sha(fs.readFileSync(ham)), 'arşiv yeniden yazıldı');
  assert.deepEqual(a.b4.dosyalar, zip.zipIcerigi(a.zipYolu));
  assert.deepEqual(
    a.b4.dosyalar.map((g) => g.yol),
    ['index.html', 'sayfa/1.txt'],
  );
  const d = y.ciktiDogrula({ cikti: o.cikti, setKimligi: '99901', acik: o.acik });
  assert.equal(d.gecti, true, d.hatalar.join('; '));

  // (b) etiketli zip → arşiv kaynak zip'in BİREBİR aynısı (yeniden sıkıştırma yok)
  const o2 = ortam();
  const hazir = path.join(o2.d, 'hazir.zip');
  zip.zipYaz(hazir, [
    { yol: 'index.html', veri: Buffer.from(o2.html('book4').replace('<head>', SHIM_ETIKETLERI)) },
    { yol: 'sayfa/1.txt', veri: Buffer.from('s1') },
  ]);
  const r2 = await ekleYayinla(o2, hazir);
  assert.deepEqual(r2.fsShim, { book4: 'zaten-var' });
  const a2 = arsivOku(o2);
  assert.equal(a2.b4.sha256, sha(fs.readFileSync(hazir)));
});

test('fs-shim: başka kitabın ad-alanını taşıyan sayfa RED; index.html yoksa uyarı', async () => {
  const o = ortam();
  o.yaz(
    'book4/index.html',
    o.html('book4').replace('<head>', '<head><script>window.__emppSubBook="book2";</script>'),
  );
  await assert.rejects(
    ekleYayinla(o, path.join(o.d, 'girdi', 'book4')),
    /başka kitabın ad-alanını taşıyor .*"book2"/,
  );

  const o2 = ortam();
  o2.yaz('book4/kapak.txt', 'k');
  o2.yaz('book4/sayfa/1.txt', 's1');
  const uyarilar = [];
  const r = await y.yayinla(
    temel(o2, 'https://ornek.invalid/guncelleme', {
      ilk: true,
      oncekiSurum: '2.66.1',
      panel: 66,
      index: o2.yaz('i.html', o2.menu('a')),
      ekle: { book4: path.join(o2.d, 'girdi', 'book4') },
    }),
    { gunluk: (m) => uyarilar.push(m) },
  );
  assert.deepEqual(r.fsShim, { book4: 'index-yok' });
  assert.ok(uyarilar.some((m) => /book4: kökte index\.html yok/.test(m)), uyarilar.join('\n'));
});

test('kaynak-sentinel: g-yayin etiketi KENDİ kurmaz — paketleyicinin tek kaynağını çağırır', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, 'yayinla.js'), 'utf8');
  assert.ok(kaynak.includes("require('../../src/packaging/fs-shim-subbook-html')"));
  assert.ok(kaynak.includes('fsShimHtml.injectFsShimIntoSubBookHtml('));
  assert.ok(!kaynak.includes('<script'), 'etiket kopyası yok (etiketi yalnız tek kaynak kurar)');
  const paketleyici = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'packaging', 'fs-shim-subbook-inject.js'),
    'utf8',
  );
  assert.match(paketleyici, /injectFsShimIntoSubBookHtml\(bookHtml, relBookDir\)/);
});

/* ------------------------------------------------ --ekle/--cikar menüye yansır (26.09, menu.js) */

/** Paketlenmiş Web-Z SET kökü (menü dosyaları + envanter) — `--menu-taban` girdisi. */
function webzKok(o, kitaplar, setKimligi = '99901') {
  const books = {};
  kitaplar.forEach(([d, id, ad], i) => {
    const coverUrl = `images/${d}.png`;
    books[d] = { assetId: id, contentType: 'book', coverUrl, displayOrder: i, title: ad };
  });
  const ayar = JSON.stringify({ bookCount: kitaplar.length, books, setTitle: 'Set' }, null, 2);
  o.yaz('kok/index.html', '<html><body><script src="scripts/language-set.js"></script></body>');
  o.yaz('kok/scripts/cevrimdisi-yama.js', `(function () {\n  window.__setSettings = ${ayar};\n})();\n`);
  o.yaz('kok/config/settings.json', ayar + '\n');
  o.yaz(
    'kok/set-menu.json',
    JSON.stringify({ kitaplar: kitaplar.map(([d, id, ad]) => ({ ad, assetId: id, klasor: d })) }),
  );
  o.yaz('kok/empp-set.json', JSON.stringify({ sema: 2, setKimligi }));
  return path.join(o.d, 'girdi', 'kok');
}

function webzKitapYaz(o, d, id, pdf) {
  o.yaz(`${d}/index.html`, o.html(d));
  o.yaz(`${d}/assets/${id}/data/BookContent.xml`, `<Book pdfUrl="pdf/${pdf}.pdf"/>`);
  o.yaz(`${d}/assets/${id}/thumbs/1.jpg`, 'jpg');
  return path.join(o.d, 'girdi', d);
}

const menuKitaplari = (setDizini, yol) => {
  const v = fs.readFileSync(path.join(setDizini, 'dosya', ...yol.split('/')), 'utf8');
  if (yol === 'set-menu.json') return JSON.parse(v).kitaplar.map((k) => k.klasor);
  // Yama: `window.__setSettings = <JSON>;` — düz metinle ayrılır (menu.js'e başvurmadan).
  const j =
    yol === 'config/settings.json'
      ? v
      : v.slice(v.indexOf('window.__setSettings = ') + 23, v.lastIndexOf(';\n})();'));
  return Object.keys(JSON.parse(j).books);
};
const WEBZ_DOSYALARI = ['config/settings.json', 'scripts/cevrimdisi-yama.js', 'set-menu.json'];

test('argsAyristir: --menu-taban ve çoklu --baslik', () => {
  const a = y.argsAyristir(['--menu-taban', '/k', '--baslik', 'book4=Ana Kitap', '--baslik', 'book5=B']);
  assert.equal(a.menuTaban, '/k');
  assert.deepEqual(a.baslik, { book4: 'Ana Kitap', book5: 'B' });
});

test('menü (Web-Z): ekle/çıkar menü dosyalarını imzalı kabuğa koyar; 2. yayın tabanı önceki G', async () => {
  const o = ortam();
  const taban = 'https://ornek.invalid/guncelleme';
  const kok = webzKok(o, [['book1', '58336', 'SB'], ['book2', '73456', 'AB'], ['book3', '58237', 'TB']]);
  const r1 = await y.yayinla(
    temel(o, taban, {
      ilk: true,
      oncekiSurum: '2.70.1',
      panel: 70,
      menuTaban: kok,
      baslik: { book4: 'Workbook' },
      ekle: { book4: webzKitapYaz(o, 'book4', '59999', 'SUPER-MONSTERS-WB') },
      cikar: ['book3'],
    }),
    sessiz,
  );
  assert.equal(r1.menu.bicim, 'webz');
  assert.deepEqual(r1.menu.kitaplar, { book3: 'cikarildi', book4: 'eklendi' });
  assert.deepEqual(r1.menu.degisen, WEBZ_DOSYALARI);
  assert.equal(r1.menu.tabanlar['config/settings.json'].kaynak, '--menu-taban');
  const setDizini = path.join(o.cikti, 'set', '99901');
  const m1 = JSON.parse(fs.readFileSync(path.join(setDizini, 'manifest.json'), 'utf8'));
  // Menü dosyaları İMZALI kabukta; sha256/boyut servis edilen baytla birebir.
  for (const yol of WEBZ_DOSYALARI) {
    const g = m1.kabuk.find((k) => k.yol === yol);
    assert.ok(g, `${yol} imzalı kabukta`);
    const v = fs.readFileSync(path.join(setDizini, 'dosya', ...yol.split('/')));
    assert.deepEqual([g.sha256, g.boyut], [sha(v), v.length]);
    assert.ok(fs.existsSync(path.join(setDizini, 'android', 'dosya', ...yol.split('/'))), 'android ucu');
    assert.deepEqual(menuKitaplari(setDizini, yol), ['book1', 'book2', 'book4'], yol);
  }
  const ayar = JSON.parse(fs.readFileSync(path.join(setDizini, 'dosya', 'config', 'settings.json'), 'utf8'));
  assert.deepEqual(ayar.books.book4, {
    assetId: '59999',
    contentType: 'book',
    coverUrl: 'book4/assets/59999/thumbs/1.jpg',
    displayOrder: 2,
    title: 'Workbook',
  });
  assert.ok(!m1.kabuk.some((k) => k.yol === 'index.html'), "Web-Z'de index'e dokunulmaz");
  assert.equal(y.ciktiDogrula({ cikti: o.cikti, setKimligi: '99901', acik: o.acik }).gecti, true);

  // 2. yayın: --menu-taban YOK — taban önceki imzalı G durumundan (yerel dosya/ kopyası).
  const r2 = await y.yayinla(temel(o, taban, { panel: 70, cikar: ['book2'] }), sessiz);
  assert.deepEqual(r2.menu.kitaplar, { book2: 'cikarildi' });
  assert.equal(r2.menu.tabanlar['scripts/cevrimdisi-yama.js'].kaynak, 'onceki-G');
  for (const yol of WEBZ_DOSYALARI) assert.deepEqual(menuKitaplari(setDizini, yol), ['book1', 'book4'], yol);

  // 3. yayın başka bir çıktı dizininde: taban CANLI uçtan iner ve imzalı sha256'yla doğrulanır.
  const o3 = { ...o, cikti: path.join(o.d, 'senaryolar', 's3') };
  const uzak = yerelUzakBaglantisi(o.cikti, '99901', taban);
  const r3 = await y.yayinla(
    temel(o3, taban, {
      panel: 70,
      oncekiManifest: path.join(setDizini, 'manifest.json'),
      cikar: ['book1'],
    }),
    { ...sessiz, getir: uzak.getir },
  );
  assert.equal(r3.menu.tabanlar['config/settings.json'].kaynak, 'onceki-G');
  assert.deepEqual(menuKitaplari(path.join(o3.cikti, 'set', '99901'), 'config/settings.json'), ['book4']);
  // Uçtaki kopya kurcalanmışsa (imzalı sha256 tutmuyor) taban kurulmaz → RED.
  fs.writeFileSync(path.join(setDizini, 'dosya', 'config', 'settings.json'), '{"books":{}}');
  const o4 = { ...o, cikti: path.join(o.d, 'senaryolar', 's4') };
  await assert.rejects(
    y.yayinla(
      temel(o4, taban, {
        panel: 70,
        oncekiManifest: path.join(setDizini, 'manifest.json'),
        cikar: ['book4'],
      }),
      { ...sessiz, getir: uzak.getir },
    ),
    /imzalı sha256 ile tutmuyor/,
  );
});

test('menü (K17): --index verilmişse kart o index üzerine eklenir; RED durumları sessiz geçmez', async () => {
  const o = ortam();
  const taban = 'https://ornek.invalid/guncelleme';
  const kitap = webzKitapYaz(o, 'book4', '60001', 'SHALL-WE-5-WORKBOOK');
  const r = await y.yayinla(
    temel(o, taban, {
      ilk: true,
      oncekiSurum: '2.71.1',
      panel: 71,
      index: o.yaz('i.html', o.menu('a')),
      ekle: { book4: kitap },
    }),
    sessiz,
  );
  assert.equal(r.menu.bicim, 'k17');
  assert.equal(r.menu.tabanlar['index.html'].kaynak, '--index');
  const idx = fs.readFileSync(path.join(o.cikti, 'set', '99901', 'dosya', 'index.html'), 'utf8');
  assert.ok(
    idx.includes(
      '<a class="kart" href="book4/index.html"><img src="book4/assets/60001/thumbs/1.jpg" ' +
        'alt="Shall We 5 Workbook"><span>Shall We 5 Workbook</span></a>',
    ),
    idx,
  );

  const yeni = (ad, ek) => temel({ ...o, cikti: path.join(o.d, 'senaryolar', ad) }, taban, {
    ilk: true,
    oncekiSurum: '2.71.1',
    panel: 71,
    ...ek,
  });
  // Taban yok (ne --index ne --menu-taban ne önceki G).
  await assert.rejects(y.yayinla(yeni('t1', { cikar: ['book3'] }), sessiz), /menü tabanı yok/);
  // Tanınmayan kök menü (yayıncının kendi menüsü).
  await assert.rejects(
    y.yayinla(yeni('t2', { index: o.yaz('ozel.html', o.html('flashy')), cikar: ['book3'] }), sessiz),
    /menü biçimi tanınmadı/,
  );
  // Başka setin paketi taban verilmiş.
  const baska = webzKok(o, [['book1', '1', 'A']], '99902');
  await assert.rejects(
    y.yayinla(yeni('t3', { menuTaban: baska, cikar: ['book1'] }), sessiz),
    /başka setin paketi/,
  );
  // --baslik yalnız eklenen kitaba.
  await assert.rejects(
    y.yayinla(
      yeni('t4', { index: o.yaz('i.html', o.menu('a')), cikar: ['book3'], baslik: { book3: 'x' } }),
      sessiz,
    ),
    /--baslik book3: yalnız --ekle/,
  );
  // Web-Z'de kimliksiz kitap eklenemez (tema kartı eler).
  o.yaz('book5/index.html', o.html('book5'));
  await assert.rejects(
    y.yayinla(
      yeni('t5', {
        menuTaban: webzKok(o, [['book1', '1', 'A']]),
        ekle: { book5: path.join(o.d, 'girdi', 'book5') },
      }),
      sessiz,
    ),
    /assetId\) ister/,
  );
});
