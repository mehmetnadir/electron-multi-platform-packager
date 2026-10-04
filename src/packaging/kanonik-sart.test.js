'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs-extra');
const K = require('./okuyucu-kabugu');
const M = require('./motor-surumu');
const S = require('./kanonik-sart');

const sha12 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const H = (c) => c.repeat(20);

/** Geçerli kanonik kabuk: <kok>/<surum>/ + kanonik.json (kayıtlı `dizin` parametre). */
async function kanonikKabuk(kok, dizinKaydi, surum = '1.13.3') {
  const kd = path.join(kok, surum);
  const main = `${H('d')}.main.js`;
  await fs.outputFile(path.join(kd, main), `x={923:"${H('e')}"}`);
  await fs.outputFile(path.join(kd, `${H('e')}.923.js`), `4147:function(e){e.exports={i8:"${surum}"}}`);
  const dosyalar = [];
  for (const ad of [main, `${H('e')}.923.js`]) {
    dosyalar.push({ ad, sha12: sha12(await fs.readFile(path.join(kd, ad))) });
  }
  await fs.writeFile(path.join(kd, 'manifest.json'), JSON.stringify({ surum, main, dosyalar }));
  const yol = path.join(kok, 'kanonik.json');
  await fs.writeFile(yol, JSON.stringify({ surum, dizin: dizinKaydi === undefined ? kd : dizinKaydi }));
  return yol;
}

const gecici = () => fs.mkdtemp(path.join(os.tmpdir(), 'kanonik-sart-'));

test('kabuk kanonik: göreli dizin kanonik.json\'a göre çözülür', async () => {
  const t = await gecici();
  const yol = await kanonikKabuk(path.join(t, 'kabuk'), '1.13.3');
  const k = await K.kanonikKabukYukle(yol);
  assert.equal(k.surum, '1.13.3');
  assert.equal(k.dizin, path.join(t, 'kabuk', '1.13.3'));
});

test('kabuk kanonik: başka makinenin mutlak yolu yoksa aynı adlı yerel alt dizine düşer', async () => {
  const t = await gecici();
  const yol = await kanonikKabuk(path.join(t, 'kabuk'), '/Users/baska/.empp-agent/kabuk/1.13.3');
  const k = await K.kanonikKabukYukle(yol);
  assert.ok(k, 'taşınmış kayıt yüklenmeli');
  assert.equal(k.dizin, path.join(t, 'kabuk', '1.13.3'));
});

test('kabuk kanonik: mutlak ve VAR olan yol aynen kullanılır; sha bozuksa null', async () => {
  const t = await gecici();
  const yol = await kanonikKabuk(path.join(t, 'kabuk'));
  assert.ok(await K.kanonikKabukYukle(yol));
  await fs.writeFile(path.join(t, 'kabuk', '1.13.3', `${H('e')}.923.js`), 'BOZUK');
  assert.equal(await K.kanonikKabukYukle(yol), null, 'sha doğrulaması aynen sürer');
});

test('kabuk kanonik: hiçbir aday yoksa null', async () => {
  const t = await gecici();
  const yol = await kanonikKabuk(path.join(t, 'kabuk'), '/yok/1.13.3');
  await fs.remove(path.join(t, 'kabuk', '1.13.3'));
  assert.equal(await K.kanonikKabukYukle(yol), null);
});

test('doldurucu betik göreli dizin yazar (taşınabilir kayıt)', async () => {
  const src = await fs.readFile(path.join(__dirname, '..', '..', 'scripts', 'kabuk-kanonik-doldur.js'), 'utf8');
  assert.match(src, /dizin: path\.basename\(dizin\)/);
});

test('motor kanonik: kanonik.json başka makineden kopyalanınca (kaynak mutlak yolu yok) yüklenir', async () => {
  const t = await gecici();
  const icerik = 'MOTOR-ICERIK';
  await fs.outputFile(path.join(t, M.MOTOR_DOSYA_ADI || '43e23fce2b7009474555a77.js'), icerik);
  const yol = path.join(t, 'kanonik.json');
  await fs.writeFile(yol, JSON.stringify({ sha12: sha12(icerik), surum: '2026.9.12',
    kaynak: '/Users/baska/etkinlik/build/43e23fce2b7009474555a77.js' }));
  const k = await M.kanonikYukle(yol);
  assert.ok(k);
  assert.equal(k.dosya, path.join(t, '43e23fce2b7009474555a77.js'));
});

test('şart: varsayılan yalnız üretim işinde (kanonikSart), =1 hep, =0 hiç', () => {
  assert.equal(S.sartAktifMi({}, {}), false);
  assert.equal(S.sartAktifMi({ kanonikSart: true }, {}), true);
  assert.equal(S.sartAktifMi({ kanonikSart: true }, { EMPP_KANONIK_SART: '0' }), false);
  assert.equal(S.sartAktifMi({}, { EMPP_KANONIK_SART: '1' }), true);
  assert.equal(S.sartAktifMi(undefined, { EMPP_KANONIK_SART: '1' }), true);
});

test('şart: kanonik yok + şart → anlaşılır hata; şart=0 → eski davranış; güncel → sorun yok', () => {
  const yok = { durum: 'bilinmiyor' };
  assert.throws(() => S.sartiUygula('kabuk', yok, { kanonikSart: true }, {}),
    (e) => e instanceof S.KanonikYokHatasi
      && /okuyucu kabuğu kanoniği yok \(~\/\.empp-agent\/kabuk\) — eski formatla paket üretilmez/.test(e.message));
  assert.throws(() => S.sartiUygula('motor', yok, { kanonikSart: true }, {}), /motor kanoniği yok/);
  assert.doesNotThrow(() => S.sartiUygula('kabuk', yok, { kanonikSart: true }, { EMPP_KANONIK_SART: '0' }));
  assert.doesNotThrow(() => S.sartiUygula('kabuk', yok, {}, {}), 'UI/elle: uyarı, düşmez');
  assert.doesNotThrow(() => S.sartiUygula('kabuk', { durum: 'guncel' }, { kanonikSart: true }, {}));
  assert.doesNotThrow(() => S.sartiUygula('kabuk', null, { kanonikSart: true }, {}), 'kapı kapalı (null)');
});

test('packagingService kabuk ve motor adımında şartı uygular; runner/app/pardus işi bayrağı taşır', async () => {
  const kok = path.join(__dirname, '..', '..');
  const ps = await fs.readFile(path.join(__dirname, 'packagingService.js'), 'utf8');
  assert.match(ps, /kanonikSart\.sartiUygula\('kabuk', kabukDamgasiSonucu, jobInfo\)/);
  assert.match(ps, /kanonikSart\.sartiUygula\('motor', motorDamgasiSonucu, jobInfo\)/);
  assert.match(await fs.readFile(path.join(kok, 'src/agent/runner.js'), 'utf8'), /kanonikSart: true/);
  assert.match(await fs.readFile(path.join(kok, 'src/server/app.js'), 'utf8'), /kanonikSart: kanonikSart === true/);
  for (const f of ['packager-run-yerel.js', 'packager-run-linux.js']) {
    const { jobInfoKur } = require(path.join(kok, 'tools/pardus', f));
    const j = f.includes('yerel')
      ? jobInfoKur({ sessionId: 's', appName: 'a', env: {} }) : jobInfoKur(['s', 'a'], {});
    assert.equal(j.kanonikSart, true, f);
  }
});
