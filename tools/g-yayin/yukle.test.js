'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const yk = require('./yukle');
const y = require('./yayinla');
const anahtar = require('./anahtar');
const { MENU_ISARETI } = require('../../src/packaging/set-menu-bicim');

const HEDEF = yk.YUKLEME_BEYAZ_LISTE['74390'];

/** Sahte R2 + CDN: rclone (lsjson/copyto) ve https getir aynı yerel "kova" dizininde. */
function sahteCanli() {
  const kova = fs.mkdtempSync(path.join(os.tmpdir(), 'g-kova-'));
  const cagri = [];
  let dusur = null;
  const yol = (uzak) => path.join(kova, uzak.slice(HEDEF.uzakKok.length + 1));
  const rclone = async (args) => {
    cagri.push(args);
    if (args[0] === 'lsjson') {
      const kok = yol(args[args.length - 1]);
      const cikti = [];
      const tara = (d, on) => {
        if (!fs.existsSync(d)) return;
        for (const g of fs.readdirSync(d, { withFileTypes: true })) {
          const gor = on ? `${on}/${g.name}` : g.name;
          if (g.isDirectory()) tara(path.join(d, g.name), gor);
          else {
            const v = fs.readFileSync(path.join(d, g.name));
            cikti.push({
              Path: gor,
              Size: v.length,
              Hashes: { md5: crypto.createHash('md5').update(v).digest('hex') },
            });
          }
        }
      };
      tara(kok, '');
      return { kod: 0, stdout: JSON.stringify(cikti), stderr: '' };
    }
    if (args[0] === 'cat') {
      const p = yol(args[1]);
      if (!fs.existsSync(p)) return { kod: 3, stdout: '', stderr: 'not found' };
      return { kod: 0, stdout: fs.readFileSync(p, 'utf8'), stderr: '' };
    }
    if (args[0] === 'copyto') {
      if (dusur && args[2].endsWith(dusur))
        return { kod: 1, stdout: '', stderr: 'sahte ağ hatası' };
      const h = yol(args[2]);
      fs.mkdirSync(path.dirname(h), { recursive: true });
      fs.copyFileSync(args[1], h);
      return { kod: 0, stdout: '', stderr: '' };
    }
    return { kod: 2, stdout: '', stderr: 'bilinmeyen' };
  };
  const cdnYolu = (adres) => path.join(kova, decodeURIComponent(new URL(adres).pathname.slice(1)));
  const getir = async (adres) => {
    const p = cdnYolu(adres);
    return fs.existsSync(p)
      ? { durum: 200, govde: fs.readFileSync(p) }
      : { durum: 404, govde: Buffer.alloc(0) };
  };
  const arsiviIndir = async (adres, hedef) => {
    const p = cdnYolu(adres);
    if (!fs.existsSync(p)) return { durum: 404, boyut: 0, ozet: '' };
    const v = fs.readFileSync(p);
    // Gerçek `arsiviIndir` sözleşmesi `hedef`e YAZAR (dogrula --arsivler içeriği okur);
    // sahte de aynı sözleşmeyi tutmalı.
    if (hedef) {
      try {
        fs.writeFileSync(hedef, v);
      } catch (e) {}
    }
    return {
      durum: 200,
      boyut: v.length,
      ozet: crypto.createHash('sha256').update(v).digest('hex'),
    };
  };
  const kopyalar = () =>
    cagri
      .filter((c) => c[0] === 'copyto')
      .map((c) => c[2].slice(`${HEDEF.uzakKok}/guncelleme/set/74390/`.length));
  return {
    kova,
    rclone,
    getir,
    arsiviIndir,
    cagri,
    kopyalar,
    dusur: (s) => {
      dusur = s;
    },
  };
}

function ortam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'g-yukle-'));
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const anahtarYolu = path.join(d, 'test.key');
  fs.writeFileSync(anahtarYolu, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const yaz = (g, v) => {
    const p = path.join(d, 'girdi', g);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, v);
    return p;
  };
  return {
    d,
    anahtarYolu,
    acik: anahtar.acikAnahtarB64(privateKey),
    yaz,
    cikti: path.join(d, 'cikti'),
  };
}

async function yayinlaOrnek(o) {
  o.yaz('book4/index.html', '<html>book4</html>');
  return y.yayinla(
    {
      komut: 'yayinla',
      setKimligi: '74390',
      taban: HEDEF.taban,
      cikti: o.cikti,
      anahtarDosya: o.anahtarYolu,
      ilk: true,
      oncekiSurum: '2.7.1',
      panel: 7,
      // Kök menü K17 sade biçiminde: `--ekle` menüye yansır (menu.js), tanınmayan kök RED.
      index: o.yaz(
        'i.html',
        `${MENU_ISARETI}\n<!doctype html><html><body>\n  <main>\n  </main>\n</body></html>\n`,
      ),
      motorlar: { book1: o.yaz('m.js', 'motor') },
      ekle: { book4: path.join(o.d, 'girdi', 'book4') },
      androidEklemeDondururKabul: true,
      cikar: [],
    },
    { gunluk: () => {} },
  );
}

test('kapı 1: beyaz liste dışı kimlik 400 — yükle ve e2e', async () => {
  await assert.rejects(
    yk.yukle({ setKimligi: '11811', cikti: '/yok', onayli: true }),
    (e) => e.durum === 400 && /beyaz/.test(e.message),
  );
  const r = await yk.e2e({ setKimligi: '99901' });
  assert.deepEqual([r.rc, r.durum, r.gecti], [1, 400, false]);
  const cli = await y
    .main(['yukle', '--set-kimligi', '59835', '--cikti', '/yok', '--onayli'])
    .catch((e) => e);
  assert.match(cli.message, /^400 — /);
  assert.deepEqual(Object.keys(yk.YUKLEME_BEYAZ_LISTE), ['74390']);
});

test('kapı 2: --onayli yoksa kuru — plan sıralı, canlıya hiçbir şey yazılmaz', async () => {
  const o = ortam();
  const c = sahteCanli();
  await yayinlaOrnek(o);
  const r = await yk.yukle({ setKimligi: '74390', cikti: o.cikti }, { ...c, beklenenAcik: o.acik });
  assert.equal(r.kuru, true);
  assert.equal(c.kopyalar().length, 0);
  const s = r.yuklenecek.map((p) => p.sira);
  assert.deepEqual(
    s,
    [...s].sort((a, b) => a - b),
  );
  assert.equal(r.yuklenecek[r.yuklenecek.length - 1].anahtar, 'guncelleme/set/74390/surum.json');
  assert.equal(r.yuklenecek[0].sira, 1, 'kitap arşivi önce');
});

test('ek kapı: TEST imzalı durum ÜRETİM anahtarı beklenirken yüklenmez', async () => {
  const o = ortam();
  const c = sahteCanli();
  await yayinlaOrnek(o);
  await assert.rejects(
    yk.yukle({ setKimligi: '74390', cikti: o.cikti, onayli: true }, c),
    /ÜRETİM anahtarıyla/,
  );
  assert.equal(c.kopyalar().length, 0);
});

test('onaylı: dosyalar → manifest+.sig → EN SON surum.json; doğrulanır; 2. koşu boş', async () => {
  const o = ortam();
  const c = sahteCanli();
  await yayinlaOrnek(o);
  const r = await yk.yukle(
    { setKimligi: '74390', cikti: o.cikti, onayli: true },
    { ...c, beklenenAcik: o.acik },
  );
  assert.equal(r.gecti, true, JSON.stringify(r));
  const k = c.kopyalar();
  assert.equal(k[k.length - 1], 'surum.json');
  assert.ok(
    k.indexOf('manifest.json') < k.indexOf('surum.json') &&
      k.indexOf('manifest.json.sig') < k.indexOf('surum.json'),
  );
  assert.ok(k.indexOf('dosya/index.html') < k.indexOf('manifest.json'));
  assert.ok(k.findIndex((x) => x.startsWith('kitap/')) === 0);
  assert.equal(r.dogrula.gecti, true);
  assert.deepEqual([r.dogrula.surum, r.dogrula.arsiv], ['2.7.2', 1]);
  const kopya = c.cagri.find((a) => a[0] === 'copyto' && a[2].endsWith('/surum.json'));
  assert.ok(kopya.includes('Cache-Control: no-cache'));
  const r2 = await yk.yukle(
    { setKimligi: '74390', cikti: o.cikti, onayli: true },
    { ...c, beklenenAcik: o.acik },
  );
  assert.equal(r2.yuklenecek.length, 0, 'tekrar koşulabilir: canlı güncel');
});

test('değişmez anahtar farklıysa yükleme yok; yarıda düşen yükleme surum.json yazmaz', async () => {
  const o = ortam();
  const c = sahteCanli();
  const r0 = await yayinlaOrnek(o);
  await yk.yukle(
    { setKimligi: '74390', cikti: o.cikti, onayli: true },
    { ...c, beklenenAcik: o.acik },
  );
  const zipAd = fs.readdirSync(path.join(o.cikti, 'set', '74390', 'kitap'))[0];
  fs.writeFileSync(path.join(c.kova, 'guncelleme', 'set', '74390', 'kitap', zipAd), 'kurcalanmış');
  const r = await yk.yukle(
    { setKimligi: '74390', cikti: o.cikti, onayli: true },
    { ...c, beklenenAcik: o.acik },
  );
  assert.equal(r.gecti, false);
  assert.match(r.cakisma.join(';'), /değişmez anahtar/);
  assert.equal(r0.surum, '2.7.2');

  // Canlı daha yeni sürümdeyse eski yerel durum yüklenmez (başka bir yayını geri götürmez).
  const surumYolu = path.join(c.kova, 'guncelleme', 'set', '74390', 'surum.json');
  fs.writeFileSync(surumYolu, JSON.stringify({ surum: '2.7.9' }));
  const rYeni = await yk.yukle(
    { setKimligi: '74390', cikti: o.cikti, onayli: true },
    { ...c, beklenenAcik: o.acik },
  );
  assert.match(rYeni.cakisma.join(';'), /canlı sürüm 2\.7\.9 .* geri götürülmez/);

  const o2 = ortam();
  const c2 = sahteCanli();
  await yayinlaOrnek(o2);
  c2.dusur('/manifest.json');
  const r2 = await yk.yukle(
    { setKimligi: '74390', cikti: o2.cikti, onayli: true },
    { ...c2, beklenenAcik: o2.acik },
  );
  assert.equal(r2.gecti, false);
  assert.match(r2.hata, /sonraki adımlar yüklenmedi/);
  assert.ok(!c2.kopyalar().includes('surum.json'));
  assert.equal(
    fs.existsSync(path.join(c2.kova, 'guncelleme', 'set', '74390', 'surum.json')),
    false,
  );
});

test('e2e: ilk → onaylı ikinci → kuru üçüncü koşu; JSON + rc; işaret tek kalır', async () => {
  const o = ortam();
  const c = sahteCanli();
  const ops = { ...c, beklenenAcik: o.acik, gunluk: () => {} };
  const idx = o.yaz('74390-index.html', '<!doctype html><html><body>74390</body></html>\n');
  const r1 = await yk.e2e(
    {
      setKimligi: '74390',
      cikti: o.cikti,
      index: idx,
      oncekiSurum: '2.7.1',
      onayli: true,
      anahtarDosya: o.anahtarYolu,
    },
    ops,
  );
  assert.equal(r1.rc, 0, JSON.stringify(r1, null, 1));
  assert.deepEqual(
    [r1.surum, r1.adimlar.dogrula.zorunlu, r1.adimlar.dogrula.gecti],
    ['2.7.2', true, true],
  );
  const r2 = await yk.e2e(
    { setKimligi: '74390', cikti: o.cikti, onayli: true, anahtarDosya: o.anahtarYolu },
    ops,
  );
  assert.equal(r2.rc, 0, JSON.stringify(r2, null, 1));
  assert.equal(r2.surum, '2.7.3');
  assert.equal(r2.adimlar.dogrula.surum, '2.7.3');
  const canliIndex = fs.readFileSync(
    path.join(c.kova, 'guncelleme', 'set', '74390', 'dosya', 'index.html'),
    'utf8',
  );
  assert.equal((canliIndex.match(/empp-g-e2e/g) || []).length, 1);
  const kopyaSayisi = c.kopyalar().length;
  const r3 = await yk.e2e(
    { setKimligi: '74390', cikti: o.cikti, anahtarDosya: o.anahtarYolu },
    ops,
  );
  assert.deepEqual(
    [r3.rc, r3.kuru, r3.surum, r3.adimlar.dogrula.zorunlu],
    [0, true, '2.7.4', false],
  );
  assert.equal(r3.adimlar.dogrula.surum, '2.7.3', 'kuru koşu canlıyı değiştirmez');
  assert.equal(c.kopyalar().length, kopyaSayisi);
  const r4 = await yk.e2e(
    { setKimligi: '74390', cikti: path.join(o.d, 'bos'), anahtarDosya: o.anahtarYolu },
    { ...ops, getir: async () => ({ durum: 404, govde: Buffer.alloc(0) }) },
  );
  assert.equal(r4.rc, 1);
  assert.match(r4.adimlar.uret.hata, /--index/);
});

test('e2eIndexi: eski işaret atılır, yenisi </html> önüne', () => {
  const a = yk.e2eIndexi('<html><body>x</body></html>', 'T1');
  const b = yk.e2eIndexi(a, 'T2');
  assert.equal((b.match(/empp-g-e2e/g) || []).length, 1);
  assert.match(b, /<!-- empp-g-e2e T2 -->\n<\/html>$/);
});

/* ------------------------------------------------ Android G ucu yüklenir + doğrulanır (26.09) */
/*
 * Android istemcisi (`src/platforms/android/empp-g-istemci.js` `kimlikKoku`) G tabanında
 * `set/<id>/android/{surum.json, manifest.json, manifest.json.sig, dosya/<yol>}` ister; kitap
 * arşivini manifestteki paylaşılan `kitap/` adresinden alır (canlı kanıt: sunucu istek günlüğü).
 * Android paketlerinde G AÇIK — uç yüklenmezse Android 404 alır, hiç güncelleme görmez.
 */

const G = require('../../src/platforms/android/empp-g-istemci.js');
const setKabuk = require('../../src/packaging/set-kabuk');
const { MOTOR_DOSYA_ADI: MOTOR } = require('./durum');
const A = (k) => `guncelleme/set/74390/android/${k}`;

/** GERÇEK Android istemcisi, sahte CDN'den (kova) okuyan köprüyle. Kitap eklemesi yok. */
async function androidIstemcisiKos(c, acik) {
  const kayit = { getir: [], uygula: [] };
  const yerel = {
    yapilandirma: async () => ({
      metin: JSON.stringify({
        setKimligi: '74390',
        taban: HEDEF.taban,
        imza: { alg: 'ed25519', acikAnahtar: acik },
      }),
      paket: JSON.stringify({ surum: '2.7.1' }),
    }),
    durum: async () => ({ surum: null }),
    getir: async ({ adres, tavan }) => {
      kayit.getir.push(new URL(adres).pathname);
      const r = await c.getir(adres);
      if (r.durum !== 200) return { durum: r.durum };
      if (tavan && r.govde.length > tavan) throw new Error('govde-tavani');
      return { durum: 200, b64: r.govde.toString('base64') };
    },
    ozetler: async ({ yollar }) => ({ ozetler: Object.fromEntries(yollar.map((x) => [x, null])) }),
    yaz: async (a) => {
      const b = Buffer.from(a.b64, 'base64');
      if (crypto.createHash('sha256').update(b).digest('hex') !== a.sha256) throw new Error('sha');
      return { tamam: true };
    },
    kitapKur: async () => {
      throw new Error('bu testte kitap eklemesi yok');
    },
    uygula: async (p) => {
      kayit.uygula.push(p);
      return { surum: p.surum };
    },
  };
  const rapor = await G.guncellemeyiCalistir({
    yerel,
    kabuk: setKabuk,
    subtle: crypto.webcrypto.subtle,
  });
  return { rapor, kayit };
}

/** Android'e uygun yayın: kök index Android bekçisini geçer (shim etiketi), motor; ekleme YOK. */
async function androidYayini(o) {
  return y.yayinla(
    {
      komut: 'yayinla',
      setKimligi: '74390',
      taban: HEDEF.taban,
      cikti: o.cikti,
      anahtarDosya: o.anahtarYolu,
      ilk: true,
      oncekiSurum: '2.7.1',
      panel: 7,
      index: o.yaz(
        'ai.html',
        '<!doctype html><html><head><script src="empp-android-shim.js"></script></head>' +
          '<body>74390</body></html>\n',
      ),
      motorlar: { book1: o.yaz('am.js', 'motor-android') },
      ekle: {},
      cikar: [],
    },
    { gunluk: () => {} },
  );
}

test('android ucu: onaylı yükleme android/ ucunu da yükler → GERÇEK Android istemcisi güncellenir', async () => {
  const o = ortam();
  const c = sahteCanli();
  const r0 = await androidYayini(o);
  const ops = { ...c, beklenenAcik: o.acik };
  const kuru = await yk.yukle({ setKimligi: '74390', cikti: o.cikti }, ops);
  const plan = kuru.yuklenecek.map((p) => p.anahtar);
  const istenen = ['dosya/index.html', `dosya/book1/${MOTOR}`, 'manifest.json'];
  istenen.push('manifest.json.sig');
  for (const k of [...istenen, 'surum.json']) assert.ok(plan.includes(A(k)), `planda yok: ${A(k)}`);
  const r = await yk.yukle(
    { setKimligi: '74390', cikti: o.cikti, onayli: true },
    { ...c, beklenenAcik: o.acik },
  );
  assert.equal(r.gecti, true, JSON.stringify(r));
  assert.equal(r.dogrula.androidDosya, 2);
  const k = c.kopyalar();
  const i = (x) => k.indexOf(x);
  // Sıra: android içerik → (her iki) manifest → iki surum.json EN SON.
  assert.ok(i('android/dosya/index.html') < i('android/manifest.json'));
  assert.ok(i('android/manifest.json') < i('android/surum.json'));
  assert.ok(i('android/manifest.json.sig') < i('android/surum.json'));
  assert.deepEqual(k.slice(-2).sort(), ['android/surum.json', 'surum.json']);
  const kopya = c.cagri.find((x) => x[0] === 'copyto' && x[2].endsWith('/android/surum.json'));
  assert.ok(kopya.includes('Cache-Control: no-cache'));
  // Android ucu canonical'la bayt bayt aynı (TEK imza).
  const kova = (g) => fs.readFileSync(path.join(c.kova, ...`guncelleme/set/74390/${g}`.split('/')));
  assert.ok(kova('android/manifest.json').equals(kova('manifest.json')));
  assert.ok(kova('android/manifest.json.sig').equals(kova('manifest.json.sig')));

  // GERÇEK Android istemcisi sahte CDN'den okur: güncellenir, istediği yollar android/ altında.
  const { rapor, kayit } = await androidIstemcisiKos(c, o.acik);
  assert.equal(rapor.durum, 'guncellendi', JSON.stringify(rapor));
  assert.equal(rapor.surum, r0.surum);
  assert.deepEqual(
    kayit.uygula[0].dosyalar.map((d) => d.yol).sort(),
    [`book1/${MOTOR}`, 'index.html'],
  );
  const kok = '/guncelleme/set/74390/android/';
  assert.ok(kayit.getir.every((p) => p.startsWith(kok)), kayit.getir.join('\n'));
  assert.deepEqual(kayit.getir.slice(0, 3), [
    `${kok}surum.json`,
    `${kok}manifest.json`,
    `${kok}manifest.json.sig`,
  ]);
});

// Canlıda eksik/bozuk android ucu → dogrula --uzak RED; eski (android'siz) canlı yeniden
// koşuyla onarılır.
test('android ucu: canlıda eksik/bozuksa dogrula --uzak RED; yeniden koşu onarır', async () => {
  const o = ortam();
  const c = sahteCanli();
  await androidYayini(o);
  const ops = { ...c, beklenenAcik: o.acik };
  await yk.yukle({ setKimligi: '74390', cikti: o.cikti, onayli: true }, ops);
  const kovaYolu = (g) => path.join(c.kova, ...`guncelleme/set/74390/${g}`.split('/'));
  const dogrula = () =>
    y.uzakDogrula({ taban: HEDEF.taban, setKimligi: '74390', acik: o.acik, getir: c.getir });
  assert.equal((await dogrula()).gecti, true);

  // Bugünkü canlı gibi: android/ ucu hiç yüklenmemiş (bu değişiklikten önceki yukle.js).
  fs.renameSync(kovaYolu('android'), kovaYolu('android-kenara'));
  const eksik = await dogrula();
  assert.equal(eksik.gecti, false);
  const eksikMetin = eksik.hatalar.join('\n');
  assert.match(eksikMetin, /android ucu: HTTP 404: .*\/set\/74390\/android\/surum\.json/);
  assert.match(eksikMetin, /android ucu: HTTP 404: .*\/android\/dosya\/index\.html/);
  // Yeniden koşu yalnız eksik android/ ucunu yükler, doğrulama geçer.
  const onar = await yk.yukle({ setKimligi: '74390', cikti: o.cikti, onayli: true }, ops);
  assert.equal(onar.gecti, true, JSON.stringify(onar));
  assert.ok(onar.yuklenen.length === 5 && onar.yuklenen.every((x) => x.includes('/android/')));

  // Bozuk android dosyası / ayrışan android manifesti / yanlış android surum.json → RED.
  const hatalar = async () => (await dogrula()).hatalar.join('\n');
  fs.writeFileSync(kovaYolu('android/dosya/index.html'), '<html>kurcalanmış</html>');
  assert.match(await hatalar(), /android\/dosya\/index\.html sha256\/boyut tutmuyor/);
  fs.copyFileSync(kovaYolu('dosya/index.html'), kovaYolu('android/dosya/index.html'));
  const canonical = fs.readFileSync(kovaYolu('manifest.json'), 'utf8');
  fs.writeFileSync(kovaYolu('android/manifest.json'), canonical + ' ');
  assert.match(await hatalar(), /android\/manifest\.json\(\.sig\) canonical .* aynı değil/);
  fs.copyFileSync(kovaYolu('manifest.json'), kovaYolu('android/manifest.json'));
  fs.writeFileSync(kovaYolu('android/surum.json'), JSON.stringify({ surum: '2.7.1' }));
  assert.match(await hatalar(), /android\/surum\.json \(2\.7\.1\) ≠ manifest \(2\.7\.2\)/);
  // Kontrol: onarılınca yine GEÇER (yukarıdaki RED'ler yalnız bozukluktan).
  fs.copyFileSync(kovaYolu('surum.json'), kovaYolu('android/surum.json'));
  assert.equal((await dogrula()).gecti, true);
});

test('android ucu: yayın öncesi — yerelde android yoksa / canlı android yeniyse yüklenmez', async () => {
  const o = ortam();
  const c = sahteCanli();
  await androidYayini(o);
  const ops = { ...c, beklenenAcik: o.acik };
  const yerelA = path.join(o.cikti, 'set', '74390', 'android', 'dosya', 'index.html');
  fs.renameSync(yerelA, yerelA + '.kenara');
  const r = await yk.yukle({ setKimligi: '74390', cikti: o.cikti, onayli: true }, ops);
  assert.equal(r.gecti, false);
  assert.match(r.cakisma.join(';'), /android\/dosya\/index\.html: yerelde yok, canlıda da yok/);
  assert.equal(c.kopyalar().length, 0);
  fs.renameSync(yerelA + '.kenara', yerelA);

  const aSurum = path.join(c.kova, 'guncelleme', 'set', '74390', 'android', 'surum.json');
  fs.mkdirSync(path.dirname(aSurum), { recursive: true });
  fs.writeFileSync(aSurum, JSON.stringify({ surum: '2.7.9' }));
  const r2 = await yk.yukle({ setKimligi: '74390', cikti: o.cikti, onayli: true }, ops);
  assert.equal(r2.gecti, false);
  assert.match(r2.cakisma.join(';'), /android\/canlı sürüm 2\.7\.9 .* geri götürülmez/);
  assert.equal(c.kopyalar().length, 0);
});
