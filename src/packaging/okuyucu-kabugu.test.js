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
