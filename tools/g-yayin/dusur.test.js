'use strict';

/**
 * `--dusur` — birikimli manifestten kabuk girdisi düşürme (06.10, 45550).
 *
 * Olay: 45550 için 2.25.8 Android shim'siz `index.html` ile yayınlandı. Manifest birikimli
 * (`durum.js`): o index sonraki HER sürüme taşınır, Android istemcisi her sürümü
 * `index-android-shim-yok` ile RED eder (ucu donar). Çözüm: index'i düşüren 2.25.9.
 *
 * Bu dosya GERÇEK üretimi (`yayinla`) GERÇEK istemcilere besler:
 *   • Android `empp-g-istemci.js` — köprü sahte (ağ yerine çıktı dizini), karar kodu gerçek.
 *   • Electron `kitap-guncelleyici.js` örtü kipi (mac/Pardus) — gerçek HTTP + gerçek fs.
 *   • Electron yerinde kip (Windows) — bugünkü davranışın belgesi.
 */

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
const kg = require('../../src/runtime/kitap-guncelleyici');
const G = require('../../src/platforms/android/empp-g-istemci.js');
const setKabuk = require('../../src/packaging/set-kabuk');
const { sunucuBaslat } = require('../g-uctan-uca/sunucu');

const SET = '99955';
/** Android istemcisi yalnız https taban kabul eder; köprü ağ yerine çıktı dizininden okur. */
const HTTPS = 'https://ornek.invalid/guncelleme';
const sessiz = { gunluk: () => {} };
const sha = (b) => crypto.createHash('sha256').update(Buffer.from(b)).digest('hex');

function ortam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'g-dusur-'));
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
  return {
    d,
    anahtarYolu,
    acik: anahtar.acikAnahtarB64(privateKey),
    yaz,
    cikti: path.join(d, 'senaryolar', 's1'),
  };
}

function temel(o, taban, ek) {
  return {
    komut: 'yayinla',
    setKimligi: SET,
    taban,
    cikti: o.cikti,
    anahtarDosya: o.anahtarYolu,
    anahtarZinciri: false,
    motorlar: {},
    ekle: {},
    cikar: [],
    dusur: [],
    ...ek,
  };
}

/** Android shim'i OLMAYAN menü — 45550 2.25.8'deki index'in biçimi. */
const SHIMSIZ = '<!doctype html><html><head><title>G 2.95.8</title></head><body>G</body></html>';
const PAKET_INDEX =
  '<!doctype html><html><head><title>PAKET</title>' +
  '<script src="empp-android-shim.js"></script></head><body>PAKET</body></html>';

/** Sahte EmppG köprüsü: `<cikti>/set/<id>/android/…`'dan GERÇEK baytları sunar. */
function kopru({ cikti, taban, acik, paketSurumu }) {
  const androidDizini = path.join(cikti, 'set', SET, 'android');
  const kimlikKoku = `${taban}/set/${SET}/android`;
  const kayit = { getir: [], yaz: [], uygula: [] };
  const yerel = {
    yapilandirma: async () => ({
      metin: JSON.stringify({
        setKimligi: SET,
        taban,
        imza: { alg: 'ed25519', acikAnahtar: acik },
      }),
      paket: JSON.stringify({ surum: paketSurumu }),
    }),
    durum: async () => ({ surum: null }),
    getir: async ({ adres }) => {
      kayit.getir.push(adres);
      if (!adres.startsWith(kimlikKoku + '/')) return { durum: 404 };
      const p = path.join(androidDizini, ...adres.slice(kimlikKoku.length + 1).split('/'));
      if (!fs.existsSync(p)) return { durum: 404 };
      return { durum: 200, b64: fs.readFileSync(p).toString('base64') };
    },
    ozetler: async ({ yollar }) => ({
      ozetler: Object.fromEntries(yollar.map((x) => [x, null])),
    }),
    yaz: async (a) => {
      kayit.yaz.push(a.yol);
      return { tamam: true };
    },
    kitapKur: async () => {
      throw new Error('bu senaryoda kitap yok');
    },
    uygula: async (p) => {
      kayit.uygula.push(p);
      return { surum: p.surum };
    },
  };
  return { yerel, kayit };
}

const androidKos = (k) =>
  G.guncellemeyiCalistir({ yerel: k.yerel, kabuk: setKabuk, subtle: crypto.webcrypto.subtle });

/** Kurulu paket (taban): kendi index'i + iki kitap + empp-set.json (gömülü açık anahtar). */
function paketKur(o, ad, taban) {
  const kok = path.join(o.d, ad);
  for (const b of ['book1', 'book2']) {
    fs.mkdirSync(path.join(kok, b), { recursive: true });
    fs.writeFileSync(path.join(kok, b, M), 'motor-v1');
    fs.writeFileSync(path.join(kok, b, 'index.html'), b);
  }
  fs.writeFileSync(path.join(kok, 'index.html'), PAKET_INDEX);
  const set = { sema: 2, setKimligi: SET, taban, imza: { alg: 'ed25519', acikAnahtar: o.acik } };
  fs.writeFileSync(path.join(kok, 'empp-set.json'), JSON.stringify(set));
  return { kok, set };
}

test('argsAyristir: --dusur virgüllü ve çoklu; varsayılan boş', () => {
  assert.deepEqual(y.argsAyristir([]).dusur, []);
  const a = y.argsAyristir(['--dusur', `index.html, book1/${M}`, '--dusur', 'set-menu.json']);
  assert.deepEqual(a.dusur, ['index.html', `book1/${M}`, 'set-menu.json']);
  assert.throws(() => y.argsAyristir(['--dusur']), /değer verilmedi/);
});

test('durum.birlestir: dusur girdiyi çıkarır; RED durumları sessiz geçmez', () => {
  const ix = { yol: 'index.html', sha256: 'a'.repeat(64), boyut: 10 };
  const mo = { yol: `book1/${M}`, sha256: 'b'.repeat(64), boyut: 5 };
  const onceki = { kabuk: [ix, mo], kitaplar: [] };
  const oz = { sha256: 'c'.repeat(64), boyut: 1 };

  const r = durum.birlestir(onceki, { dusur: ['index.html'] });
  assert.deepEqual(r.kabuk, [mo]);
  assert.deepEqual(r.ozet.dusenKabuk, ['index.html']);
  assert.deepEqual(r.ozet.degisenKabuk, []);
  assert.deepEqual(r.ozet.tasinanKabuk, [`book1/${M}`]);

  const hepsi = durum.birlestir(onceki, { dusur: ['index.html', `book1/${M}`, 'index.html'] });
  assert.deepEqual(hepsi.kabuk, [], 'tüm kabuk düşebilir (kabuk=[])');

  assert.throws(
    () => durum.birlestir({ kabuk: [mo], kitaplar: [] }, { dusur: ['index.html'] }),
    /önceki imzalı durumda böyle bir kabuk girdisi yok/,
  );
  assert.throws(() => durum.birlestir(null, { dusur: ['index.html'] }), /girdisi yok/);
  assert.throws(
    () => durum.birlestir(onceki, { dusur: ['index.html'], index: oz }),
    /aynı yayında yeniden yazılıyor/,
  );
  assert.throws(
    () => durum.birlestir(onceki, { dusur: [`book1/${M}`], motorlar: { book1: oz } }),
    /aynı yayında yeniden yazılıyor/,
  );
  assert.throws(
    () => durum.birlestir(onceki, { dusur: ['set-menu.json'], menu: { 'set-menu.json': oz } }),
    /aynı yayında yeniden yazılıyor/,
  );
  assert.throws(() => durum.birlestir(onceki, { dusur: ['main.js'] }), /G kapsamında değil/);
  assert.throws(
    () => durum.birlestir(onceki, { dusur: ['../index.html'] }),
    /G kapsamında değil/,
  );
  assert.throws(() => durum.birlestir(onceki, { dusur: [] }), /--dusur/);
});

test("uçtan uca: shim'siz index → Android RED; --dusur → Android KABUL, örtü paket index'i", async () => {
  const o = ortam();
  const s = await sunucuBaslat({ dizin: o.d, port: 0, tls: null, gunluk: () => {} });
  try {
    const taban = `http://127.0.0.1:${s.port}/s1/guncelleme`;

    // 1) 2.95.8 — 45550'deki 2.25.8'in eşi: Android shim'siz index.
    const r1 = await y.yayinla(
      temel(o, taban, {
        ilk: true,
        oncekiSurum: '2.95.7',
        panel: 95,
        index: o.yaz('i.html', SHIMSIZ),
      }),
      sessiz,
    );
    assert.equal(r1.surum, '2.95.8');
    const k1 = kopru({ cikti: o.cikti, taban: HTTPS, acik: o.acik, paketSurumu: '2.95.7' });
    const a1 = await androidKos(k1);
    assert.equal(a1.durum, 'red', JSON.stringify(a1));
    assert.equal(a1.sebep, 'index-android-shim-yok');
    assert.equal(k1.kayit.uygula.length, 0);

    // Electron örtü (mac/Pardus): 2.95.8 kurulur, index örtüden sunulur.
    const p = paketKur(o, 'kurulu-ortu', taban);
    const ortuKoku = path.join(o.d, 'ortu');
    const calistir = (k) =>
      kg.guncellemeyiCalistir({ taban, set: k.set, kok: k.kok, gunluk: () => {}, ...k.ek });
    const e1 = await calistir({ ...p, ek: { ortuKoku } });
    assert.equal(e1.durum, 'guncellendi', JSON.stringify(e1));
    const d1 = kg.ortuDurumuYukle({ kok: p.kok, ortuKoku });
    assert.equal(d1.gecerli, true, d1.sebep);
    const c1 = kg.ortuCoz(d1, 'index.html');
    assert.equal(c1.tur, 'ortu');
    assert.equal(fs.readFileSync(c1.yol, 'utf8'), SHIMSIZ);

    // Electron yerinde (Windows): 2.95.8 index'i paket köküne yazar.
    const w = paketKur(o, 'kurulu-win', taban);
    const w1 = await calistir({ ...w, ek: {} });
    assert.equal(w1.durum, 'guncellendi', JSON.stringify(w1));
    assert.equal(fs.readFileSync(path.join(w.kok, 'index.html'), 'utf8'), SHIMSIZ);

    // 2) 2.95.9 — index düşer: kabuk=[], imzalı, iki uç birebir.
    const r2 = await y.yayinla(temel(o, taban, { panel: 95, dusur: ['index.html'] }), sessiz);
    assert.equal(r2.surum, '2.95.9');
    assert.equal(r2.onceki, '2.95.8');
    assert.equal(r2.kabuk, 0);
    assert.deepEqual(r2.dusenKabuk, ['index.html']);
    assert.deepEqual(r2.degisenKabuk, []);
    const setDizini = path.join(o.cikti, 'set', SET);
    const govde = fs.readFileSync(path.join(setDizini, 'manifest.json'));
    const imza = fs.readFileSync(path.join(setDizini, 'manifest.json.sig'), 'utf8');
    assert.equal(anahtar.dogrula(govde, imza, o.acik), true, 'yeni manifest imzalı');
    const m = JSON.parse(govde.toString('utf8'));
    assert.deepEqual(m.kabuk, []);
    assert.equal(m.surum, '2.95.9');
    assert.ok(govde.equals(fs.readFileSync(path.join(setDizini, 'android', 'manifest.json'))));
    const plan = JSON.parse(fs.readFileSync(r2.plan, 'utf8')).yukle.map((x) => x.anahtar);
    assert.ok(!plan.some((a) => a.includes('/dosya/')), `plan dosya yüklememeli: ${plan}`);
    assert.ok(plan.includes(`guncelleme/set/${SET}/surumler/2.95.9/manifest.json`));
    assert.ok(plan.includes(`guncelleme/set/${SET}/android/surum.json`));
    const yd = y.ciktiDogrula({ cikti: o.cikti, setKimligi: SET, acik: o.acik });
    assert.equal(yd.gecti, true, yd.hatalar.join('; '));
    const u = await y.uzakDogrula({
      taban,
      setKimligi: SET,
      acik: o.acik,
      beklenenSurum: '2.95.9',
      arsivler: true,
    });
    assert.equal(u.gecti, true, u.hatalar.join('; '));
    assert.deepEqual([u.surum, u.dosya, u.androidDosya], ['2.95.9', 0, 0]);

    // Android: 2.95.9 KABUL — tek atomik uygula (sürüm damgalanır), dosya yok. İçerik
    // değişmediği için istemci 'guncel/icerik-ayni-surum-damgalandi' der; RED değildir ve katman
    // artık 2.95.9'dadır (sonraki motor yayınları akar).
    const k2 = kopru({ cikti: o.cikti, taban: HTTPS, acik: o.acik, paketSurumu: '2.95.7' });
    const a2 = await androidKos(k2);
    assert.equal(a2.durum, 'guncel', JSON.stringify(a2));
    assert.equal(a2.sebep, 'icerik-ayni-surum-damgalandi');
    assert.equal(a2.surum, '2.95.9');
    assert.equal(k2.kayit.uygula.length, 1);
    assert.deepEqual(k2.kayit.uygula[0].dosyalar, []);

    // Electron örtü: 2.95.9 kurulur; index ÖRTÜDEN ÇIKAR → paketin kendi index'i sunulur.
    const e2 = await calistir({ ...p, ek: { ortuKoku } });
    assert.equal(e2.durum, 'guncellendi', JSON.stringify(e2));
    const d2 = kg.ortuDurumuYukle({ kok: p.kok, ortuKoku });
    assert.equal(d2.gecerli, true, d2.sebep);
    assert.equal(d2.surum, '2.95.9');
    assert.equal(d2.ortuYollari.size, 0);
    assert.equal(kg.ortuCoz(d2, 'index.html'), null, 'null = paketin kendi kopyası');
    assert.equal(sha(fs.readFileSync(path.join(p.kok, 'index.html'))), sha(PAKET_INDEX));

    // Electron yerinde (Windows): sürüm ilerler; düşen index geri ALINMAZ (2.95.8 baytı kalır —
    // paket kopyası 2.95.8 yazımıyla ezilmişti; o index Electron için geçerlidir).
    const w2 = await calistir({ ...w, ek: {} });
    assert.equal(w2.durum, 'guncellendi', JSON.stringify(w2));
    assert.equal(fs.readFileSync(path.join(w.kok, 'index.html'), 'utf8'), SHIMSIZ);

    // 3) Tekrar düşürmek RED (önceki imzalı durumda yok); yeni sürüm üretilmez.
    await assert.rejects(
      y.yayinla(temel(o, taban, { panel: 95, dusur: ['index.html'] }), sessiz),
      /önceki imzalı durumda böyle bir kabuk girdisi yok/,
    );
    const sj = JSON.parse(fs.readFileSync(path.join(setDizini, 'surum.json'), 'utf8'));
    assert.equal(sj.surum, '2.95.9');
  } finally {
    await s.kapat();
  }
});

test('--dusur ile --index aynı yolda çelişki → RED, çıktıya dokunulmaz', async () => {
  const o = ortam();
  const taban = 'https://ornek.invalid/guncelleme';
  await y.yayinla(
    temel(o, taban, {
      ilk: true,
      oncekiSurum: '2.95.7',
      panel: 95,
      index: o.yaz('i.html', SHIMSIZ),
    }),
    sessiz,
  );
  const mYolu = path.join(o.cikti, 'set', SET, 'manifest.json');
  const once = fs.readFileSync(mYolu);
  await assert.rejects(
    y.yayinla(
      temel(o, taban, {
        panel: 95,
        dusur: ['index.html'],
        index: o.yaz('j.html', PAKET_INDEX),
      }),
      sessiz,
    ),
    /aynı yayında yeniden yazılıyor/,
  );
  assert.ok(once.equals(fs.readFileSync(mYolu)));
});
