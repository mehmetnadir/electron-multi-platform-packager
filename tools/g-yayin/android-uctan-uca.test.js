'use strict';

/**
 * g-yayin → Android G istemcisi UÇTAN UCA — gerçek üretim, gerçek istemci kodu.
 *
 * `tools/g-yayin/yayinla.js` artık `<cikti>/set/<id>/android/{surum.json, manifest.json,
 * manifest.json.sig, dosya/<yol>}` üretir (TEK imza paylaşılır — Windows/mac manifestiyle
 * BİREBİR aynı bayt). Bu test o üretimi GERÇEK Android istemcisine (`src/platforms/android/
 * empp-g-istemci.js`, dal `g-android` — birlesik-20260926'dan aynen alındı, değiştirilmedi)
 * doğrudan besler: sahte "EmppG köprüsü" ağ yerine `--cikti` dizininden okur, ama istemcinin
 * kendi imza/kimlik/sürüm/kapsam mantığı GERÇEK kod yolundan geçer.
 *
 * Sözleşme: `.claude/docs/platform-kanallari-sozlesmesi.md` "Android G katmanı".
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const y = require('./yayinla');
const anahtar = require('./anahtar');
const { MOTOR_DOSYA_ADI: M } = require('./durum');
const G = require('../../src/platforms/android/empp-g-istemci.js');
const kabuk = require('../../src/packaging/set-kabuk');
const { MENU_ISARETI } = require('../../src/packaging/set-menu-bicim');

const SET_KIMLIGI = '81900';
const TABAN = 'https://ornek.invalid/guncelleme';

function ortam() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'g-android-uctan-uca-'));
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
  // Kök `index.html` Android bekçisini geçmeli: `empp-android-shim.js`'i script olarak çağırır
  // (gerçek Android paketlemesinde bu satır zaten menüye enjekte edilir — `empp-g-istemci.js`
  // §Android bekçisi; yoksa "index-android-shim-yok" ile RET).
  const html = (t) =>
    `<!doctype html><html><head><title>${t}</title>` +
    `<script src="empp-android-shim.js"></script></head><body>${t}</body></html>`;
  // Kök MENÜ (K17 sade biçimi): `--ekle` menüye yansır (menu.js) — tanınmayan kök RED.
  const menu = (t) =>
    `${MENU_ISARETI}\n<!doctype html><html><head><title>${t}</title>` +
    '<script src="empp-android-shim.js"></script></head><body>\n  <main>\n  </main>\n' +
    '</body></html>\n';
  return {
    d,
    anahtarYolu,
    acik: anahtar.acikAnahtarB64(privateKey),
    yaz,
    html,
    menu,
    cikti: path.join(d, 'cikti'),
  };
}

/** Gerçek g-yayin üretimi: ilk yayın, kök index + book7 eklenmiş bir kitap. */
async function uretimYap(o) {
  o.yaz('book7/index.html', o.html('book7'));
  o.yaz(`book7/${M}`, 'motor-kitap7-v1');
  return y.yayinla(
    {
      komut: 'yayinla',
      setKimligi: SET_KIMLIGI,
      taban: TABAN,
      cikti: o.cikti,
      anahtarDosya: o.anahtarYolu,
      ilk: true,
      oncekiSurum: '2.81.1',
      panel: 81,
      index: o.yaz('i.html', o.menu('menu')),
      motorlar: {},
      ekle: { book7: path.join(o.d, 'girdi', 'book7') },
      // Android ekleme kapısı: anahtarsız --ekle RED (yayinla.js `androidEklemeKapisi`). Bu test
      // WIRING sınar ve sahte köprü üç Android işaretini `true` döndürür — gerçek Java katmanı
      // bu Electron biçimli arşivi reddeder; anahtar o yüzden BİLİNÇLİ verildi.
      androidEklemeDondururKabul: true,
      cikar: [],
    },
    { gunluk: () => {} },
  );
}

/**
 * Sahte EmppG köprüsü — ağ yerine `--cikti/set/<setKimligi>/android/…`'dan GERÇEK baytları okur;
 * kitap zip'ini de `--cikti/set/<setKimligi>/kitap/<ad>.zip`'ten okuyup sha256/boyut doğrular
 * (Android'e özgü shim/manifest içerik denetimi gerçek Java katmanının işidir — burada FAKE
 * kabul edilir, çünkü test konusu WIRING: imza/kimlik/sürüm/kapsam doğru mu).
 * `aktifSetKimligi` istemcinin KENDİ paket konfigürasyonundaki set kimliğidir — üretimin
 * gerçek `setKimligi`'nden FARKLI verilirse "yabancı set" senaryosu kurulmuş olur (istemci
 * URL'i kendi kimliğiyle kurar, köprü onu üretimin sabit dizinine çözer — böylece AYNI
 * imzalı içerik farklı bir kimlik altında sunulmuş gibi davranır).
 */
function koprüKur({ cikti, setKimligi, aktifSetKimligi, taban, acik, yerelSurum = null, paketSurumu }) {
  const androidDizini = path.join(path.resolve(cikti), 'set', String(setKimligi), 'android');
  const kimlikKoku = `${taban}/set/${encodeURIComponent(aktifSetKimligi)}/android`;
  const cozYol = (adres) => {
    if (!adres.startsWith(kimlikKoku + '/')) return null;
    return path.join(
      androidDizini,
      ...adres
        .slice(kimlikKoku.length + 1)
        .split('/')
        .map(decodeURIComponent),
    );
  };
  const kayit = { getir: [], yaz: [], kitapKur: [], uygula: [] };
  const yerel = {
    yapilandirma: async () => ({
      metin: JSON.stringify({
        setKimligi: aktifSetKimligi,
        taban,
        imza: { alg: 'ed25519', acikAnahtar: acik },
      }),
      paket: paketSurumu === undefined ? undefined : JSON.stringify({ surum: paketSurumu }),
    }),
    durum: async () => ({ surum: yerelSurum }),
    getir: async ({ adres, tavan }) => {
      kayit.getir.push(adres);
      const p = cozYol(adres);
      if (!p || !fs.existsSync(p)) return { durum: 404 };
      const v = fs.readFileSync(p);
      if (tavan && v.length > tavan) throw new Error('govde-tavani');
      return { durum: 200, b64: v.toString('base64') };
    },
    ozetler: async ({ yollar }) => {
      const o = {};
      for (const yol of yollar) o[yol] = null; // taze kurulum: yerelde hiçbiri yok
      return { ozetler: o };
    },
    yaz: async (a) => {
      const bayt = Buffer.from(a.b64, 'base64');
      if (crypto.createHash('sha256').update(bayt).digest('hex') !== a.sha256) {
        throw new Error('sha256-uyusmaz');
      }
      kayit.yaz.push(a.sha256);
      return { tamam: true };
    },
    kitapKur: async (a) => {
      kayit.kitapKur.push(a);
      const kitapOneki = `${taban}/set/${encodeURIComponent(setKimligi)}/kitap/`;
      if (!a.adres.startsWith(kitapOneki)) throw new Error('kitap adresi beklenmeyen kökte: ' + a.adres);
      const ad = decodeURIComponent(a.adres.slice(kitapOneki.length));
      const zipYolu = path.join(path.resolve(cikti), 'set', String(setKimligi), 'kitap', ad);
      const v = fs.readFileSync(zipYolu);
      if (v.length !== a.boyut) throw new Error('boyut-uyusmaz');
      if (crypto.createHash('sha256').update(v).digest('hex') !== a.sha256) {
        throw new Error('sha256-uyusmaz');
      }
      return {
        klasor: `${a.dizin}-${a.sha256.slice(0, 16)}`,
        dosyaSayisi: 1,
        indexShimli: true,
        shimVar: true,
        manifestVar: true,
      };
    },
    uygula: async (p) => {
      kayit.uygula.push(p);
      return { surum: p.surum };
    },
  };
  return { yerel, kayit };
}

const ortamG = (yerel) => ({ yerel, kabuk, subtle: crypto.webcrypto.subtle });

test('android e2e: g-yayin üretimi Android istemcisine (empp-g-istemci) besleniyor — KABUL edilir', async () => {
  const o = ortam();
  const r = await uretimYap(o);
  assert.equal(r.surum, '2.81.2');

  const { yerel, kayit } = koprüKur({
    cikti: o.cikti,
    setKimligi: SET_KIMLIGI,
    aktifSetKimligi: SET_KIMLIGI,
    taban: TABAN,
    acik: o.acik,
    yerelSurum: null,
    paketSurumu: '2.81.1',
  });
  const rapor = await G.guncellemeyiCalistir(ortamG(yerel));
  assert.equal(rapor.durum, 'guncellendi', JSON.stringify(rapor));
  assert.equal(rapor.imzaYolu, 'webcrypto');
  assert.equal(rapor.surum, r.surum);
  assert.deepEqual(rapor.eklenen, ['book7']);
  assert.deepEqual(rapor.cikarilan, []);
  assert.equal(kayit.uygula.length, 1, 'TEK atomik uygula');
  const p = kayit.uygula[0];
  assert.equal(p.surum, r.surum);
  assert.deepEqual(p.kitaplar.map((k) => k.dizin), ['book7']);
  // book7'nin motoru YENİ eklenen arşivin İÇİNDE gelir (durum.js: "yeni arşiv kendi motorunu
  // taşır") — bu yayında kabuk yalnız kök `index.html`'i taşır, `book7/<motor>` ayrı gelmez.
  assert.deepEqual(p.dosyalar.map((d) => d.yol), ['index.html']);
  // O index, eklenen kitabın KARTINI taşır (menu.js, K17): Android de aynı menüyü alır.
  assert.deepEqual(r.menu.kitaplar, { book7: 'eklendi' });
  const sunulan = fs.readFileSync(
    path.join(o.cikti, 'set', SET_KIMLIGI, 'android', 'dosya', 'index.html'),
    'utf8',
  );
  assert.match(sunulan, /<a class="kart" href="book7\/index\.html">/);
  assert.equal(p.dosyalar[0].sha256, crypto.createHash('sha256').update(sunulan).digest('hex'));
  assert.equal(kayit.kitapKur.length, 1);
  assert.equal(kayit.kitapKur[0].dizin, 'book7');
  assert.equal(kayit.kitapKur[0].sha256, p.kitaplar[0].sha256);
});

test('android e2e: yabancı set konfigürasyonu → RET, manifest hiç istenmez', async () => {
  const o = ortam();
  await uretimYap(o);

  const { yerel, kayit } = koprüKur({
    cikti: o.cikti,
    setKimligi: SET_KIMLIGI,
    aktifSetKimligi: '99999', // paketin KENDİ kimliği üretimin kimliğinden FARKLI
    taban: TABAN,
    acik: o.acik,
    yerelSurum: null,
  });
  const rapor = await G.guncellemeyiCalistir(ortamG(yerel));
  assert.equal(rapor.durum, 'atlandi');
  assert.equal(rapor.sebep, 'uzak-baska-set');
  assert.equal(kayit.getir.length, 1, 'yalnız surum.json istendi — kimlik uyuşmazlığı orada yakalandı');
  assert.equal(kayit.yaz.length + kayit.kitapKur.length + kayit.uygula.length, 0);
});

test('android e2e: yerelde daha yeni/eşit sürüm varsa (eski sürüm) → RET, manifest hiç istenmez', async () => {
  const o = ortam();
  const r = await uretimYap(o);

  const { yerel, kayit } = koprüKur({
    cikti: o.cikti,
    setKimligi: SET_KIMLIGI,
    aktifSetKimligi: SET_KIMLIGI,
    taban: TABAN,
    acik: o.acik,
    yerelSurum: null,
    paketSurumu: '2.81.9', // cihaz üretimimizden (2.81.2) daha yeni bir sürümde
  });
  const rapor = await G.guncellemeyiCalistir(ortamG(yerel));
  assert.equal(rapor.durum, 'guncel');
  assert.equal(rapor.sebep, 'uzak-surum-buyuk-degil');
  assert.equal(kayit.getir.length, 1, 'yalnız surum.json istendi, manifest hiç indirilmedi');
  assert.equal(kayit.uygula.length, 0);
  assert.notEqual(r.surum, undefined);

  // Aynı üretim, cihaz TAM o sürümdeyse: 'guncel' ama farklı sebep (damga eşit).
  const { yerel: yerel2, kayit: kayit2 } = koprüKur({
    cikti: o.cikti,
    setKimligi: SET_KIMLIGI,
    aktifSetKimligi: SET_KIMLIGI,
    taban: TABAN,
    acik: o.acik,
    yerelSurum: r.surum,
  });
  const rapor2 = await G.guncellemeyiCalistir(ortamG(yerel2));
  assert.equal(rapor2.durum, 'guncel');
  assert.equal(rapor2.sebep, 'surum-ayni');
  assert.equal(kayit2.getir.length, 1);
});
