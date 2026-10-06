'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs-extra');
const K = require('./okuyucu-kabugu');

const sha12 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const H = (c) => c.repeat(20);

/** Kabuk dizini: index.html + main.js (parça haritası) + i8'li parça. */
async function kabukYaz(dir, { main, parcaHash, surum, css }) {
  await fs.ensureDir(dir);
  await fs.writeFile(path.join(dir, `${main}`), `x={923:"${parcaHash}"}`);
  await fs.writeFile(path.join(dir, `${parcaHash}.923.js`), `4147:function(e){e.exports={i8:"${surum}"}}`);
  if (css) await fs.writeFile(path.join(dir, css), `/*${surum}*/`);
}

async function alanKur({ paketSurum = '1.11.5', kanonikSurum = '1.13.3', kitapSayisi = 2 } = {}) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kabuk-'));
  const kok = path.join(tmp, 'paket');
  for (let i = 1; i <= kitapSayisi; i += 1) {
    const b = path.join(kok, `book${i}`);
    await kabukYaz(b, { main: `${H('a')}.main.js`, parcaHash: H('b'), surum: paketSurum, css: `${H('c')}.main.css` });
    await fs.writeFile(path.join(b, 'index.html'),
      `<head><script src="app.config.js"></script><script defer="defer" src="./${H('a')}.main.js"></script>`
      + `<link href="./${H('c')}.main.css" rel="stylesheet"></head>`);
    await fs.writeFile(path.join(b, 'version.txt'), paketSurum);
    await fs.writeFile(path.join(b, 'icons.js'), 'ESKI-IKON');
    await fs.writeFile(path.join(b, 'app.config.js'), 'KITABA-OZGU');
    await fs.outputFile(path.join(b, 'assets', '1', 'pages', '1.png'), 'SAYFA');
    await fs.outputFile(path.join(b, 'data', 'BookContent.xml'), '<x/>');
  }
  await fs.writeFile(path.join(kok, 'paket.json'), JSON.stringify({ setId: 'S1' }));
  // kanonik
  const kd = path.join(tmp, 'kabuk', kanonikSurum);
  const main = `${H('d')}.main.js`;
  const mainCss = `${H('f')}.main.css`;
  await kabukYaz(kd, { main, parcaHash: H('e'), surum: kanonikSurum, css: mainCss });
  await fs.writeFile(path.join(kd, 'icons.js'), 'YENI-IKON');
  const dosyalar = [];
  for (const ad of [main, `${H('e')}.923.js`, mainCss, 'icons.js']) {
    dosyalar.push({ ad, sha12: sha12(await fs.readFile(path.join(kd, ad))) });
  }
  await fs.writeFile(path.join(kd, 'manifest.json'), JSON.stringify({ surum: kanonikSurum, main, mainCss, dosyalar }));
  const kYol = path.join(tmp, 'kabuk', 'kanonik.json');
  await fs.writeFile(kYol, JSON.stringify({ surum: kanonikSurum, dizin: kd }));
  return { tmp, kok, kYol, main, mainCss };
}

test('eski kabuk → her bookN değişir, rozet kanonik; içerik/app.config DOKUNULMAZ; eskiler ağaç dışında', async () => {
  const { tmp, kok, kYol, main, mainCss } = await alanKur();
  try {
    const d = await K.okuyucuKabuguDegistir(kok, kYol);
    assert.equal(d.durum, 'guncel');
    assert.equal(d.degisen, 2);
    const b = path.join(kok, 'book1');
    const html = await fs.readFile(path.join(b, 'index.html'), 'utf8');
    assert.ok(html.includes(`src="./${main}"`) && html.includes(`href="./${mainCss}"`));
    assert.ok(html.includes('app.config.js'), 'şablon korunur');
    assert.equal(await fs.readFile(path.join(b, 'version.txt'), 'utf8'), '1.13.3');
    assert.equal(await fs.readFile(path.join(b, 'icons.js'), 'utf8'), 'YENI-IKON');
    assert.equal(await fs.readFile(path.join(b, 'app.config.js'), 'utf8'), 'KITABA-OZGU');
    assert.equal(await fs.readFile(path.join(b, 'assets/1/pages/1.png'), 'utf8'), 'SAYFA');
    assert.equal(await fs.pathExists(path.join(b, `${H('a')}.main.js`)), false, 'ölü eski main.js kökte yok');
    const yedek = path.join(tmp, '.empp-eski', 'paket', 'book1');
    assert.equal(await fs.readFile(path.join(yedek, 'icons.js'), 'utf8'), 'ESKI-IKON');
    assert.ok((await fs.readFile(path.join(yedek, 'index.html'), 'utf8')).includes(H('a')));
    assert.equal(await fs.pathExists(path.join(kok, '.empp-eski')), false);
    const pj = JSON.parse(await fs.readFile(path.join(kok, 'paket.json'), 'utf8'));
    assert.equal(pj.setId, 'S1');
    assert.equal(pj.kabukSurumu.kanonikSurum, '1.13.3');
    const kapi = await K.kabukKapisi(kok, await K.kanonikKabukYukle(kYol));
    assert.equal(kapi.gecti, true);
  } finally { await fs.remove(tmp); }
});

test('MUTASYON: kanonik daha ESKİYSE değiştirmez', async () => {
  const { tmp, kok, kYol } = await alanKur({ paketSurum: '1.13.8', kanonikSurum: '1.13.3' });
  try {
    const d = await K.okuyucuKabuguDegistir(kok, kYol);
    assert.equal(d.degisen, 0);
    assert.ok(d.kitaplar.every((k) => k.karar === 'yeni'));
    assert.equal(await fs.readFile(path.join(kok, 'book1', 'icons.js'), 'utf8'), 'ESKI-IKON');
  } finally { await fs.remove(tmp); }
});

test('MUTASYON: aynı sürüm → dokunmaz', async () => {
  const { tmp, kok, kYol } = await alanKur({ paketSurum: '1.13.3', kanonikSurum: '1.13.3' });
  try {
    const d = await K.okuyucuKabuguDegistir(kok, kYol);
    assert.equal(d.degisen, 0);
    assert.equal(await fs.pathExists(path.join(tmp, '.empp-eski')), false);
  } finally { await fs.remove(tmp); }
});

test('GÜVENLİK: kanonik yok / dosya sha bozuk → hiçbir şey değişmez, bilinmiyor, kapı null', async () => {
  const { tmp, kok, kYol } = await alanKur();
  try {
    const kd = JSON.parse(await fs.readFile(kYol, 'utf8')).dizin;
    await fs.writeFile(path.join(kd, 'icons.js'), 'BOZUK');
    assert.equal(await K.kanonikKabukYukle(kYol), null);
    const d = await K.okuyucuKabuguDegistir(kok, kYol);
    assert.equal(d.durum, 'bilinmiyor');
    assert.equal(await fs.readFile(path.join(kok, 'book1', 'icons.js'), 'utf8'), 'ESKI-IKON');
    assert.equal((await K.kabukKapisi(kok, null)).gecti, null);
  } finally { await fs.remove(tmp); }
});

test('GERİ ALMA: kanonik main rozeti tutmazsa kitap eski hâline döner, karar hata', async () => {
  const { tmp, kok, kYol } = await alanKur();
  try {
    const kanonik = await K.kanonikKabukYukle(kYol);
    const d = await K.okuyucuKabuguDegistir(kok, kYol, { kanonik: { ...kanonik, surum: '1.14.0' } });
    assert.equal(d.durum, 'karisik');
    assert.ok(d.kitaplar.every((k) => k.karar === 'hata'));
    const b = path.join(kok, 'book1');
    assert.equal(await fs.readFile(path.join(b, 'icons.js'), 'utf8'), 'ESKI-IKON');
    assert.ok((await fs.readFile(path.join(b, 'index.html'), 'utf8')).includes(H('a')));
    assert.equal(await fs.readFile(path.join(b, 'version.txt'), 'utf8'), '1.11.5');
    assert.equal(await fs.pathExists(path.join(b, `${H('d')}.main.js`)), false, 'eklenen geri çekildi');
  } finally { await fs.remove(tmp); }
});

test('kapsam: bookN yoksa kök (tek kitap) işlenir', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kabuk-tek-'));
  try {
    assert.deepEqual(await K.kitapDizinleri(tmp), ['']);
    await fs.ensureDir(path.join(tmp, 'book10'));
    await fs.ensureDir(path.join(tmp, 'book2'));
    assert.deepEqual(await K.kitapDizinleri(tmp), ['book2', 'book10']);
  } finally { await fs.remove(tmp); }
});

test('acikMi: varsayılan açık, EMPP_OKUYUCU_KABUGU=0 kapatır', () => {
  assert.equal(K.acikMi({}), true);
  assert.equal(K.acikMi({ EMPP_OKUYUCU_KABUGU: '0' }), false);
});

test('ÇEKİRDEK: eksik core varlığı eklenir, var olan core dosyası EZİLMEZ; kapı eksikte düşer', async () => {
  const { tmp, kok, kYol } = await alanKur();
  try {
    const kd = JSON.parse(await fs.readFile(kYol, 'utf8')).dizin;
    const m = JSON.parse(await fs.readFile(path.join(kd, 'manifest.json'), 'utf8'));
    await fs.outputFile(path.join(kd, 'core/icons/ButtonCollab.svg'), 'YENI-SVG');
    await fs.outputFile(path.join(kd, 'core/kurumlogo.png'), 'WEBZ-LOGO');
    m.cekirdek = [
      { ad: 'core/icons/ButtonCollab.svg', sha12: sha12('YENI-SVG') },
      { ad: 'core/kurumlogo.png', sha12: sha12('WEBZ-LOGO') },
    ];
    await fs.writeFile(path.join(kd, 'manifest.json'), JSON.stringify(m));
    await fs.outputFile(path.join(kok, 'book1/core/kurumlogo.png'), 'KURUM-LOGO');
    await fs.outputFile(path.join(kok, 'book2/core/kurumlogo.png'), 'KURUM-LOGO');
    const kanonik = await K.kanonikKabukYukle(kYol);
    // kapı önce: kabuk eski
    assert.equal((await K.kabukKapisi(kok, kanonik)).gecti, false);
    await K.okuyucuKabuguDegistir(kok, kYol);
    const b = path.join(kok, 'book1');
    assert.equal(await fs.readFile(path.join(b, 'core/icons/ButtonCollab.svg'), 'utf8'), 'YENI-SVG');
    assert.equal(await fs.readFile(path.join(b, 'core/kurumlogo.png'), 'utf8'), 'KURUM-LOGO', 'logo ezilmedi');
    assert.equal((await K.kabukKapisi(kok, kanonik)).gecti, true);
    // mutasyon: eklenen varlığı kaldır (yedeğe taşı) → kapı düşer
    await fs.move(path.join(b, 'core/icons/ButtonCollab.svg'), path.join(tmp, 'x.svg'));
    const kapi = await K.kabukKapisi(kok, kanonik);
    assert.equal(kapi.gecti, false);
    assert.deepEqual(kapi.kitaplar[0].eksikCekirdek, ['core/icons/ButtonCollab.svg']);
  } finally { await fs.remove(tmp); }
});

test('tamAdlaVarMi: büyük/küçük harf duyarlı', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'harf-'));
  try {
    await fs.outputFile(path.join(tmp, 'core/kurumlogo.png'), 'x');
    assert.equal(await K.tamAdlaVarMi(tmp, 'core/kurumlogo.png'), true);
    assert.equal(await K.tamAdlaVarMi(tmp, 'core/kurumLogo.png'), false);
  } finally { await fs.remove(tmp); }
});

test('ÇEKİRDEK: kabuk zaten kanonikse yalnız eksik varlık eklenir, başka dosya değişmez', async () => {
  const { tmp, kok, kYol } = await alanKur({ paketSurum: '1.13.3', kanonikSurum: '1.13.3' });
  try {
    const kd = JSON.parse(await fs.readFile(kYol, 'utf8')).dizin;
    const m = JSON.parse(await fs.readFile(path.join(kd, 'manifest.json'), 'utf8'));
    await fs.outputFile(path.join(kd, 'core/jump-to-page-icon.png'), 'PNG');
    m.cekirdek = [{ ad: 'core/jump-to-page-icon.png', sha12: sha12('PNG') }];
    await fs.writeFile(path.join(kd, 'manifest.json'), JSON.stringify(m));
    const d = await K.okuyucuKabuguDegistir(kok, kYol);
    assert.equal(d.degisen, 0);
    assert.equal(d.kitaplar[0].eklenenCekirdek, 1);
    assert.equal(await fs.readFile(path.join(kok, 'book1/core/jump-to-page-icon.png'), 'utf8'), 'PNG');
    assert.equal(await fs.readFile(path.join(kok, 'book1/icons.js'), 'utf8'), 'ESKI-IKON');
    assert.equal(await fs.pathExists(path.join(tmp, '.empp-eski')), false);
  } finally { await fs.remove(tmp); }
});

test('indexMainReferanslari: ./önek, ?v= sorgusu, link href → taban adlar', () => {
  const html = '<script defer src="./abc123.main.js"></script><script src="def.main.js?v=3"></script>'
    + '<link href="x9.main.css" rel=stylesheet><script src="app.config.js"></script>';
  assert.deepEqual(K.indexMainReferanslari(html), { js: ['abc123.main.js', 'def.main.js'], css: ['x9.main.css'] });
  assert.deepEqual(K.indexMainReferanslari('<head></head>'), { js: [], css: [] });
});

test('ESKİ MAIN: değişim sonrası eski main.js/main.css yedeğe taşınır, kökte kalmaz', async () => {
  const { tmp, kok, kYol } = await alanKur();
  try {
    const d = await K.okuyucuKabuguDegistir(kok, kYol);
    assert.ok(d.kitaplar.every((k) => k.karar === 'degisti' && k.eskiMainTasinan === 2));
    const b = path.join(kok, 'book1');
    const yedek = path.join(tmp, '.empp-eski', 'paket', 'book1');
    for (const ad of [`${H('a')}.main.js`, `${H('c')}.main.css`]) {
      assert.equal(await fs.pathExists(path.join(b, ad)), false, `${ad} kökte yok`);
      assert.ok(await fs.pathExists(path.join(yedek, ad)), `${ad} yedekte var`);
    }
  } finally { await fs.remove(tmp); }
});

test('ESKİ MAIN: eski ad kanonikle aynıysa taşınmaz', async () => {
  const { tmp, kok, kYol, main, mainCss } = await alanKur({ kitapSayisi: 1 });
  try {
    const b = path.join(kok, 'book1');
    await fs.copy(path.join(b, `${H('a')}.main.js`), path.join(b, main));
    await fs.copy(path.join(b, `${H('c')}.main.css`), path.join(b, mainCss));
    await fs.writeFile(path.join(b, 'index.html'),
      `<head><script defer src="./${main}"></script><link href="./${mainCss}" rel="stylesheet"></head>`);
    const d = await K.okuyucuKabuguDegistir(kok, kYol);
    assert.equal(d.kitaplar[0].karar, 'degisti');
    assert.equal(d.kitaplar[0].eskiMainTasinan, 0);
    assert.ok(await fs.pathExists(path.join(b, main)) && await fs.pathExists(path.join(b, mainCss)));
  } finally { await fs.remove(tmp); }
});

/** 45550 book4 biçimi: eski kabuk (1.9.12.5) index'te `.main` EKSİZ giriş çağırır. */
async function eksizKitapYaz(b, surum = '1.9.12.5') {
  await kabukYaz(b, { main: `${H('7')}.js`, parcaHash: H('8'), surum, css: `${H('9')}.css` });
  await fs.writeFile(path.join(b, 'index.html'),
    `<head><script src="app.config.js"></script><script src="43e23fce2b7009474555a77.js"></script>`
    + `<script defer="defer" src="./${H('7')}.js"></script>`
    + `<link href="./favicon.ico" rel="icon"><link href="./${H('9')}.css" rel="stylesheet"></head>`);
}

test('ESKİ KABUK (.main eksiz, 45550): rozet okunur → degisti; index kanonik; eski ana js/css yedekte', async () => {
  const { tmp, kok, kYol, main, mainCss } = await alanKur({ kitapSayisi: 1, kanonikSurum: '1.13.14' });
  try {
    const b = path.join(kok, 'book1');
    await eksizKitapYaz(b);
    const d = await K.okuyucuKabuguDegistir(kok, kYol);
    assert.equal(d.kitaplar[0].onceSurum, '1.9.12.5', 'eksiz girişten rozet okundu');
    assert.equal(d.kitaplar[0].karar, 'degisti');
    assert.equal(d.durum, 'guncel');
    const html = await fs.readFile(path.join(b, 'index.html'), 'utf8');
    assert.ok(html.includes(`src="./${main}"`), 'index kanonik main.js gösterir');
    assert.ok(html.includes(`href="./${mainCss}"`), 'index kanonik main.css gösterir');
    assert.equal(html.includes(H('7')), false, 'eski ana js referansı kalmadı');
    assert.equal(html.includes(H('9')), false, 'eski css referansı kalmadı');
    assert.equal((html.match(/rel="stylesheet"/g) || []).length, 1, 'ikinci css bağı eklenmedi');
    assert.ok(html.includes('43e23fce2b7009474555a77.js') && html.includes('./favicon.ico'), 'şablon korunur');
    const yedek = path.join(tmp, '.empp-eski', 'paket', 'book1');
    for (const ad of [`${H('7')}.js`, `${H('9')}.css`]) {
      assert.equal(await fs.pathExists(path.join(b, ad)), false, `${ad} kökte yok`);
      assert.ok(await fs.pathExists(path.join(yedek, ad)), `${ad} .empp-eski'de`);
    }
    assert.equal(d.kitaplar[0].eskiMainTasinan, 2);
    assert.equal(await fs.pathExists(path.join(b, `${H('8')}.923.js`)), true, 'webpack parçası yerinde');
    assert.equal(await fs.readFile(path.join(b, 'app.config.js'), 'utf8'), 'KITABA-OZGU');
    const kapi = await K.kabukKapisi(kok, await K.kanonikKabukYukle(kYol));
    assert.equal(kapi.gecti, true);
  } finally { await fs.remove(tmp); }
});

test('indexYenidenYaz: .main\'li giriş eski davranış; eksiz tek giriş yazılır; webpack parçası ana sanılmaz', () => {
  const m = `${H('d')}.main.js`;
  const c = `${H('f')}.main.css`;
  // .main'li — eski davranış aynen
  const eski = `<head><script src="./${H('a')}.main.js"></script><link href="./${H('c')}.main.css" rel="stylesheet"></head>`;
  assert.equal(K.indexYenidenYaz(eski, m, c),
    `<head><script src="./${m}"></script><link href="./${c}" rel="stylesheet"></head>`);
  // eksiz — ?sorgu ve tek tırnak da yazılır
  assert.equal(K.indexYenidenYaz(`<head><script src='${H('7')}.js?v=2'></script></head>`, m, c),
    `<head><script src='./${m}'></script><link href="./${c}" rel="stylesheet"></head>`);
  // webpack parçası `<h20>.<id>.js` ana giriş DEĞİL; motor (23 hane) da değil
  const parca = `<head><script src="./${H('8')}.336.js"></script><script src="43e23fce2b7009474555a77.js"></script></head>`;
  assert.equal(K.tekEksizAnaAd(parca, 'src', 'js'), null);
  assert.deepEqual(K.indexMainReferanslari(parca), { js: [], css: [] });
  assert.equal(K.indexYenidenYaz(parca, m, null), parca, 'parça referansına dokunulmaz');
  // parça + eksiz ana → yalnız ana seçilir
  const karisik = `<script src="./${H('8')}.336.js"></script><script src="./${H('7')}.js"></script>`;
  assert.deepEqual(K.indexMainReferanslari(karisik).js, [`${H('7')}.js`]);
  // iki eksiz aday = belirsiz → ana giriş yok, dokunulmaz
  const iki = `<script src="./${H('7')}.js"></script><script src="./${H('6')}.js"></script>`;
  assert.equal(K.tekEksizAnaAd(iki, 'src', 'js'), null);
  assert.equal(K.indexYenidenYaz(iki, m, null), iki);
  // .main varsa eksiz aday yok sayılır
  assert.deepEqual(K.indexMainReferanslari(`<script src="./${H('7')}.js"></script><script src="x.main.js"></script>`).js,
    ['x.main.js']);
});

test('ESKİ KABUK: iki eksiz aday (belirsiz) → rozet okunmaz, kitap DEĞİŞMEZ, karisik', async () => {
  const { tmp, kok, kYol } = await alanKur({ kitapSayisi: 1 });
  try {
    const b = path.join(kok, 'book1');
    await eksizKitapYaz(b);
    await fs.writeFile(path.join(b, 'index.html'),
      `<head><script src="./${H('7')}.js"></script><script src="./${H('6')}.js"></script></head>`);
    const once = await fs.readFile(path.join(b, 'index.html'), 'utf8');
    const d = await K.okuyucuKabuguDegistir(kok, kYol);
    assert.equal(d.kitaplar[0].karar, 'bilinmiyor');
    assert.equal(d.durum, 'karisik');
    assert.equal(await fs.readFile(path.join(b, 'index.html'), 'utf8'), once);
  } finally { await fs.remove(tmp); }
});

test('OKUYUCUSUZ bookN (11811 book6: yalnız PDF) → kabuksuz; durum guncel; kapı geçer; kayıtta görünür', async () => {
  const { tmp, kok, kYol } = await alanKur({ kitapSayisi: 2 });
  try {
    const b6 = path.join(kok, 'book6');
    await fs.outputFile(path.join(b6, 'SUPER-MONSTERS-4-Teachers-Pack.pdf'), '%PDF');
    const d = await K.okuyucuKabuguDegistir(kok, kYol);
    assert.equal(d.durum, 'guncel');
    assert.equal(d.degisen, 2);
    const k6 = d.kitaplar.find((k) => k.dizin === 'book6');
    assert.equal(k6.karar, 'kabuksuz');
    assert.deepEqual(await fs.readdir(b6), ['SUPER-MONSTERS-4-Teachers-Pack.pdf'], 'dizine dokunulmadı');
    const pj = JSON.parse(await fs.readFile(path.join(kok, 'paket.json'), 'utf8'));
    assert.equal(pj.kabukSurumu.kitaplar.find((k) => k.dizin === 'book6').karar, 'kabuksuz');
    const kapi = await K.kabukKapisi(kok, await K.kanonikKabukYukle(kYol));
    assert.equal(kapi.gecti, true);
    assert.equal(kapi.kitaplar.find((k) => k.dizin === 'book6').karar, 'kabuksuz');
    // yalnız okuyucusuz kitap varsa kapı GEÇMEZ (boş küme yeşil değil)
    const tek = await fs.mkdtemp(path.join(os.tmpdir(), 'kabuk-pdf-'));
    try {
      await fs.outputFile(path.join(tek, 'book1', 'a.pdf'), '%PDF');
      assert.equal((await K.kabukKapisi(tek, await K.kanonikKabukYukle(kYol))).gecti, false);
    } finally { await fs.remove(tek); }
  } finally { await fs.remove(tmp); }
});

test('okuyucusuzMu: tek kitap kökü istisnaya girmez', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kabuk-oku-'));
  try {
    assert.equal(await K.okuyucusuzMu(tmp, ''), false);
    await fs.ensureDir(path.join(tmp, 'book1'));
    assert.equal(await K.okuyucusuzMu(tmp, 'book1'), true);
    await fs.writeFile(path.join(tmp, 'book1', 'index.html'), '<head></head>');
    assert.equal(await K.okuyucusuzMu(tmp, 'book1'), false);
  } finally { await fs.remove(tmp); }
});

// ── A1 DÜZENİ (06.10, kasa 45496 2.53.4: "karisik, 0 kitap değişti" → kabul işçisinde bayat) ──
// Kök index.html sf425 kabuğu (main.js çağırmaz); okuyucu sayfası kapak/index.html (<base href="../">),
// main.js + parçalar KÖKTE. Eski kod kökü ölçüyordu → rozet yok → 'bilinmiyor' → 'karisik', kabuk eski kaldı.
const A1 = require('./a1-duzen');
const SF425 = '<html><head><script src="scripts/language-set.js"></script></head><body>kartlar</body></html>';

async function a1AlanKur({ paketSurum = '1.13.3', kanonikSurum = '1.13.14', isaret = true, dll = true } = {}) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kabuk-a1-'));
  const kok = path.join(tmp, 'paket');
  await kabukYaz(kok, { main: `${H('a')}.main.js`, parcaHash: H('b'), surum: paketSurum, css: `${H('c')}.main.css` });
  await fs.writeFile(path.join(kok, 'index.html'), SF425);
  const motor = `<html><head><script src="app.config.js"></script><script defer="defer" src="./${H('a')}.main.js">`
    + `</script><link href="./${H('c')}.main.css" rel="stylesheet"></head><body></body></html>`;
  await fs.outputFile(path.join(kok, 'kapak', 'index.html'), isaret ? A1.baslikEkle(motor) : motor);
  await fs.writeFile(path.join(kok, 'app.config.js'), 'KOK-CONFIG');
  if (dll) await fs.outputFile(path.join(kok, 'classlibraries', 'ImWin32.dll'), 'DLL');
  await fs.writeFile(path.join(kok, 'version.txt'), '1.11.5');
  await fs.outputFile(path.join(kok, 'assets', '33828', 'pages', '1.png'), 'SAYFA');
  await fs.writeFile(path.join(kok, 'paket.json'), JSON.stringify({ setId: '45496' }));
  const kd = path.join(tmp, 'kabuk', kanonikSurum);
  const main = `${H('d')}.main.js`;
  const mainCss = `${H('f')}.main.css`;
  await kabukYaz(kd, { main, parcaHash: H('e'), surum: kanonikSurum, css: mainCss });
  const dosyalar = [];
  for (const ad of [main, `${H('e')}.923.js`, mainCss]) {
    dosyalar.push({ ad, sha12: sha12(await fs.readFile(path.join(kd, ad))) });
  }
  await fs.writeFile(path.join(kd, 'manifest.json'), JSON.stringify({ surum: kanonikSurum, main, mainCss, dosyalar }));
  const kYol = path.join(tmp, 'kabuk', 'kanonik.json');
  await fs.writeFile(kYol, JSON.stringify({ surum: kanonikSurum, dizin: kd }));
  return { tmp, kok, kYol, main, mainCss };
}

test('A1: birim kök + kapak/index.html (kök sf425 ölçülmez); bookN düzeni değişmez', async () => {
  const { tmp, kok } = await a1AlanKur();
  try {
    assert.deepStrictEqual(await K.kabukBirimleri(kok), [{ rel: '', index: 'kapak/index.html', duzen: 'a1' }]);
  } finally { await fs.remove(tmp); }
  const b = await alanKur();
  try {
    assert.deepStrictEqual(await K.kabukBirimleri(b.kok), [
      { rel: 'book1', index: 'index.html' }, { rel: 'book2', index: 'index.html' }]);
  } finally { await fs.remove(b.tmp); }
});

test('A1 eski kabuk (1.13.3 < 1.13.14) → kökte değişir, kapak/index.html yeniden yazılır, durum guncel', async () => {
  const { tmp, kok, kYol, main, mainCss } = await a1AlanKur();
  try {
    const d = await K.okuyucuKabuguDegistir(kok, kYol);
    assert.equal(d.durum, 'guncel', 'A1 karisik DEĞİL');
    assert.equal(d.degisen, 1);
    assert.equal(d.kitaplar[0].duzen, 'a1');
    assert.equal(d.kitaplar[0].onceSurum, '1.13.3');
    assert.equal(d.kitaplar[0].sonraSurum, '1.13.14');
    const kapak = await fs.readFile(path.join(kok, 'kapak', 'index.html'), 'utf8');
    assert.ok(kapak.includes(`src="./${main}"`) && kapak.includes(`href="./${mainCss}"`));
    assert.deepStrictEqual(A1.kapakDenetle(kapak), [], 'A1 başlığı (<base> + kök betiği) korunur');
    assert.equal(await fs.readFile(path.join(kok, 'index.html'), 'utf8'), SF425, 'kök sf425 kabuğu DOKUNULMAZ');
    assert.ok(await fs.pathExists(path.join(kok, main)), 'kanonik main kökte');
    assert.equal(await fs.pathExists(path.join(kok, 'kapak', main)), false, 'kapak/ altına dosya kopyalanmaz');
    assert.equal(await fs.pathExists(path.join(kok, `${H('a')}.main.js`)), false, 'eski main ağaç dışına taşındı');
    assert.ok(await fs.pathExists(path.join(tmp, '.empp-eski', 'paket', 'kapak', 'index.html')), 'eski kapak yedekte');
    assert.equal(await fs.readFile(path.join(kok, 'app.config.js'), 'utf8'), 'KOK-CONFIG');
    assert.equal(await fs.readFile(path.join(kok, 'assets/33828/pages/1.png'), 'utf8'), 'SAYFA');
    const pj = JSON.parse(await fs.readFile(path.join(kok, 'paket.json'), 'utf8'));
    assert.equal(pj.kabukSurumu.durum, 'guncel');
    const kapi = await K.kabukKapisi(kok, await K.kanonikKabukYukle(kYol));
    assert.equal(kapi.gecti, true, kapi.sebep);
    assert.equal(kapi.kitaplar[0].duzen, 'a1');
  } finally { await fs.remove(tmp); }
});

// Ş1 (inceleme 06.10): A1'de birim kökü = PAKET KÖKÜ. Kök version.txt yayıncı güncelleme
// KANAL DAMGASIdır (publisher-update currentVersion, kapı m.11) — kabuk sürümüyle ezilmemeli.
test('Ş1 A1 kabuk değişimi kök version.txt kanal damgasını EZMEZ (bayt-eşit)', async () => {
  const { tmp, kok, kYol } = await a1AlanKur();
  try {
    const once = await fs.readFile(path.join(kok, 'version.txt'));
    const d = await K.okuyucuKabuguDegistir(kok, kYol);
    assert.equal(d.kitaplar[0].karar, 'degisti');
    const sonra = await fs.readFile(path.join(kok, 'version.txt'));
    assert.ok(once.equals(sonra), `kök version.txt değişti: ${once} → ${sonra}`);
    assert.equal(await fs.pathExists(path.join(kok, 'kapak', 'version.txt')), false,
      'kapak/ altına version.txt yazılmaz');
  } finally { await fs.remove(tmp); }
});

test('A1 kabuk zaten kanonik → ölçüm guncel, hiçbir dosya değişmez', async () => {
  const { tmp, kok, kYol } = await a1AlanKur({ paketSurum: '1.13.14' });
  try {
    const onceKapak = await fs.readFile(path.join(kok, 'kapak', 'index.html'), 'utf8');
    const d = await K.okuyucuKabuguDegistir(kok, kYol);
    assert.equal(d.durum, 'guncel');
    assert.equal(d.degisen, 0);
    assert.equal(d.kitaplar[0].karar, 'ayni');
    assert.equal(await fs.readFile(path.join(kok, 'kapak', 'index.html'), 'utf8'), onceKapak);
    assert.equal(await fs.pathExists(path.join(tmp, '.empp-eski')), false);
  } finally { await fs.remove(tmp); }
});

test('A1 kabukKapisi: eski kabuk (değişim öncesi) → GEÇMEZ (fail-closed sürer)', async () => {
  const { tmp, kok, kYol } = await a1AlanKur();
  try {
    const kapi = await K.kabukKapisi(kok, await K.kanonikKabukYukle(kYol));
    assert.equal(kapi.gecti, false);
    assert.equal(kapi.kitaplar[0].karar, 'eski');
  } finally { await fs.remove(tmp); }
});

test('MUTASYON A1 bozuk (işaret var, kökte ImWin32.dll yok) → karisik, dokunulmaz', async () => {
  const { tmp, kok, kYol } = await a1AlanKur({ dll: false });
  try {
    const onceKapak = await fs.readFile(path.join(kok, 'kapak', 'index.html'), 'utf8');
    const d = await K.okuyucuKabuguDegistir(kok, kYol);
    assert.equal(d.durum, 'karisik');
    assert.equal(d.degisen, 0);
    assert.match(d.kitaplar[0].hata, /ImWin32\.dll/);
    assert.equal(await fs.readFile(path.join(kok, 'kapak', 'index.html'), 'utf8'), onceKapak);
    const kapi = await K.kabukKapisi(kok, await K.kanonikKabukYukle(kYol));
    assert.equal(kapi.gecti, false);
  } finally { await fs.remove(tmp); }
});

test('MUTASYON A1 işareti yok (kapak/ var ama A1 değil) → eski yol: kök ölçülür, rozet yok → karisik', async () => {
  const { tmp, kok, kYol } = await a1AlanKur({ isaret: false });
  try {
    const d = await K.okuyucuKabuguDegistir(kok, kYol);
    assert.equal(d.durum, 'karisik', 'A1 olmayan rozetsiz kök fail-closed kalır');
    assert.equal(d.kitaplar[0].duzen, undefined);
  } finally { await fs.remove(tmp); }
});
