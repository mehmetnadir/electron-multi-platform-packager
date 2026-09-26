'use strict';

/**
 * SET GÜNCELLEME PAKETİ testleri (`guncelleme-paketi.js`).
 *
 * DİSİPLİN: gerçek dosya sistemi (`mkdtemp`), gerçek `tar` süreci — mocklu değil.
 * Kopya-mantık kontrolü: üretilen `surum`, üreticinin (`scripts/guncelleme-manifesti-uret.js`)
 * KENDİ `main()` çağrısıyla bağımsızca hesaplanan sürümle birebir karşılaştırılır.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const gp = require('./guncelleme-paketi');
const uretici = require('../../scripts/guncelleme-manifesti-uret');
const guncelleyiciEnjekte = require('./guncelleyici-enjekte');

function gecici(ad) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'empp-gp-' + ad + '-'));
}

function agacKur(kok, dosyalar) {
  for (const yol of Object.keys(dosyalar)) {
    const tam = path.join(kok, yol);
    fs.mkdirSync(path.dirname(tam), { recursive: true });
    fs.writeFileSync(tam, dosyalar[yol]);
  }
  return kok;
}

/** Küçük ama gerçekçi bir SET kökü — index.html + assets2/ + core/ + kitap dizini. */
function ornekSetKoku() {
  return agacKur(gecici('set-koku'), {
    'index.html': '<html>MENU</html>',
    'set_app.config': 'ad=Ornek',
    'assets2/menu.png': 'PNGVERISI',
    'core/logo.png': 'LOGOVERISI',
    'book7/index.html': '<html>book7</html>',
    'node_modules/paket/index.js': 'module.exports={}',
  });
}

function tarIcerigi(tarYolu) {
  return execFileSync('tar', ['-tzf', tarYolu], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
}

/* ---------------------------------------------------------------------- kapı */

test('acikMi: guncelleyici-enjekte ile AYNI kapı (kopya YOK)', () => {
  assert.strictEqual(gp.acikMi, guncelleyiciEnjekte.acikMi);
  assert.strictEqual(gp.acikMi({}), true);
  assert.strictEqual(gp.acikMi({ EMPP_SET_GUNCELLEME: '0' }), false);
});

/* ------------------------------------------------------------- setKimligi yok */

test('paketeUret: setKimligi yoksa NO-OP ama GÖRÜNÜR (log satırı) — dosya YAZILMAZ', async () => {
  const setKoku = ornekSetKoku();
  const cikti = path.join(gecici('cikti'), 'guncelleme');
  const satirlar = [];

  const sonuc = await gp.paketeUret(setKoku, {
    setKimligi: null,
    jobId: 'job-yok',
    cikti,
    log: (s) => satirlar.push(s),
  });

  assert.deepStrictEqual(sonuc, { atlandi: true, sebep: 'setKimligi yok' });
  assert.ok(satirlar.some((s) => /güncelleme paketi atlandı: setKimligi yok/.test(s)));
  assert.strictEqual(fs.existsSync(cikti), false);
});

test('paketeUret: setKimligi boş string ise de atlar (falsy — geçersiz kimlik tahmin edilmez)', async () => {
  const setKoku = ornekSetKoku();
  const cikti = path.join(gecici('cikti2'), 'guncelleme');
  const sonuc = await gp.paketeUret(setKoku, { setKimligi: '', jobId: 'x', cikti });
  assert.strictEqual(sonuc.atlandi, true);
});

/* --------------------------------------------------------------- üretim yolu */

test('paketeUret: set/<id>/{surum.json,manifest.json,dosya/…} üretir + guncelleme.tar.gz paketler', async () => {
  const setKoku = ornekSetKoku();
  const ciktiKoku = gecici('cikti3');
  const cikti = path.join(ciktiKoku, 'guncelleme');

  const sonuc = await gp.paketeUret(setKoku, {
    setKimligi: '11811',
    jobId: 'job-abc',
    cikti,
    log: () => {},
  });

  assert.ok(!sonuc.atlandi);
  assert.strictEqual(typeof sonuc.surum, 'string');
  assert.ok(sonuc.kabukDosyaSayisi >= 4); // index.html, set_app.config, assets2/menu.png, core/logo.png
  assert.strictEqual(sonuc.tarYolu, path.join(cikti, 'guncelleme.tar.gz'));
  assert.ok(sonuc.boyut > 0);

  // Ham çıktı dizini de gerçekten orada — üretici çekirdeği çağrılmış (kopya değil).
  const setDizini = path.join(cikti, 'set', '11811');
  assert.ok(fs.existsSync(path.join(setDizini, 'surum.json')));
  assert.ok(fs.existsSync(path.join(setDizini, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(setDizini, 'dosya', 'index.html')));

  // book7/node_modules asla kopyalanmadı.
  assert.strictEqual(fs.existsSync(path.join(setDizini, 'dosya', 'book7')), false);

  // tar.gz gerçekten var ve İÇİNDE üç uç nokta de var — MUTASYON KANITI: bu liste
  // `surum.json` içermeseydi bir sonraki assert düşerdi (elle denendi: tarUret'teki
  // `tar` argümanlarından `set` kaldırılıp boş arşiv üretilince bu test FAIL etti,
  // geri alınınca PASS'e döndü).
  const icerik = tarIcerigi(sonuc.tarYolu);
  assert.ok(icerik.some((s) => s === 'set/11811/surum.json'), icerik.join(','));
  assert.ok(icerik.some((s) => s === 'set/11811/manifest.json'), icerik.join(','));
  assert.ok(icerik.some((s) => s === 'set/11811/dosya/index.html'), icerik.join(','));
});

test('paketeUret: cikti verilmezse temp/<jobId>/windows/guncelleme varsayılır', async () => {
  const setKoku = ornekSetKoku();
  const jobId = 'test-varsayilan-' + Date.now();
  const beklenenCikti = path.join('temp', jobId, 'windows', 'guncelleme');

  try {
    const sonuc = await gp.paketeUret(setKoku, { setKimligi: '99', jobId, log: () => {} });
    assert.strictEqual(sonuc.tarYolu, path.join(beklenenCikti, 'guncelleme.tar.gz'));
    assert.ok(fs.existsSync(beklenenCikti));
  } finally {
    await fsp.rm(path.join('temp', jobId), { recursive: true, force: true });
  }
});

test('paketeUret: sürüm, üreticinin KENDİ main() çağrısıyla bağımsızca hesaplanan sürümle AYNI (kopya mantık yok)', async () => {
  const setKoku = ornekSetKoku();
  const ciktiA = path.join(gecici('kopyasiz-a'), 'guncelleme');
  const ciktiB = gecici('kopyasiz-b');

  const sonucGp = await gp.paketeUret(setKoku, { setKimligi: '555', jobId: 'k', cikti: ciktiA });
  const raporUretici = await uretici.main([
    '--set-koku', setKoku, '--set-kimligi', '555', '--cikti', ciktiB,
  ]);

  assert.strictEqual(sonucGp.surum, raporUretici.surum);
  assert.strictEqual(sonucGp.kabukDosyaSayisi, raporUretici.kabukDosyaSayisi);
});

test('paketeUret: hata build\'i düşürmez şekilde çağrılabilir — setKoku yok/okunamaz ise anlamlı hata fırlatır (yutmaz)', async () => {
  const cikti = path.join(gecici('hata'), 'guncelleme');
  await assert.rejects(
    gp.paketeUret('/olmayan/set/koku/kesin', { setKimligi: '1', jobId: 'h', cikti }),
    /set kökü okunamadı/,
  );
});

/* ------------------------------------------------ manifest imzası (sözleşme G4) */

function testAnahtari() {
  const crypto = require('node:crypto');
  const cift = crypto.generateKeyPairSync('ed25519');
  const dizin = gecici('anahtar');
  const yol = path.join(dizin, 'test.pem');
  fs.writeFileSync(yol, cift.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  return { yol, acik: cift.publicKey };
}

test('G4: imzaAnahtari verilince manifest.json.sig yazılır, açık anahtarla doğrulanır, tar\'da var', async () => {
  const crypto = require('node:crypto');
  const { yol, acik } = testAnahtari();
  const cikti = path.join(gecici('imzali'), 'guncelleme');
  const sonuc = await gp.paketeUret(ornekSetKoku(), {
    setKimligi: '59835', cikti, imzaAnahtari: yol, env: {}, log: () => {},
  });
  assert.strictEqual(sonuc.imzali, true);
  const d = path.join(cikti, 'set', '59835');
  const govde = fs.readFileSync(path.join(d, 'manifest.json'));
  const imza = Buffer.from(fs.readFileSync(path.join(d, 'manifest.json.sig'), 'utf8').trim(), 'base64');
  assert.ok(crypto.verify(null, govde, acik, imza));
  assert.ok(tarIcerigi(sonuc.tarYolu).includes('set/59835/manifest.json.sig'));
});

test('G4: anahtar yolu env EMPP_GUNCELLEME_IMZA_ANAHTARI\'dan da okunur; hiçbiri yoksa imzali:false + görünür log', async () => {
  const { yol } = testAnahtari();
  const c1 = path.join(gecici('env'), 'guncelleme');
  const s1 = await gp.paketeUret(ornekSetKoku(), {
    setKimligi: '1', cikti: c1, env: { EMPP_GUNCELLEME_IMZA_ANAHTARI: yol }, log: () => {},
  });
  assert.strictEqual(s1.imzali, true);
  const satirlar = [];
  const c2 = path.join(gecici('imzasiz'), 'guncelleme');
  const s2 = await gp.paketeUret(ornekSetKoku(), {
    setKimligi: '1', cikti: c2, env: {}, log: (x) => satirlar.push(x),
  });
  assert.strictEqual(s2.imzali, false);
  assert.strictEqual(fs.existsSync(path.join(c2, 'set', '1', 'manifest.json.sig')), false);
  assert.ok(satirlar.some((x) => /İMZASIZ/.test(x)), satirlar.join('\n'));
});
