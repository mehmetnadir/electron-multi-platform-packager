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
