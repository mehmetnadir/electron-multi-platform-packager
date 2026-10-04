'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { bosOzet, ozetCikar, paketJsondanOku, logdanOzet, govdeAlanlari } = require('./kanonik-surum');

const BOS = { motorSha12: null, motorDurum: null, kabukSurum: null, kabukDurum: null };

function gecici() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanonik-surum-'));
}

test('ozetCikar: motor + kabuk damgası dört alana eşlenir', () => {
  const o = ozetCikar({
    motorSurumu: { sha12: 'abcdef012345', durum: 'guncel', kanonikSha12: 'abcdef012345' },
    kabukSurumu: { durum: 'guncel', kanonikSurum: '2.4.1' },
  });
  assert.deepStrictEqual(o, {
    motorSha12: 'abcdef012345', motorDurum: 'guncel', kabukSurum: '2.4.1', kabukDurum: 'guncel',
  });
});

test('ozetCikar: yalnız motor varsa kabuk alanları null', () => {
  const o = ozetCikar({ motorSurumu: { sha12: null, durum: 'karisik' } });
  assert.deepStrictEqual(o, { ...BOS, motorDurum: 'karisik' });
});

test('ozetCikar: motor damgası liste ise ilk nesne kaydı alınır', () => {
  const o = ozetCikar({ motorSurumu: [null, { sha12: '111111111111', durum: 'ayni' }] });
  assert.strictEqual(o.motorSha12, '111111111111');
  assert.strictEqual(o.motorDurum, 'ayni');
});

test('ozetCikar: çöp girdide fırlatmaz, hepsi null', () => {
  for (const girdi of [null, undefined, 5, 'x', [], { motorSurumu: 7, kabukSurumu: 'x' }]) {
    assert.deepStrictEqual(ozetCikar(girdi), BOS);
  }
});

test('ozetCikar: sha12 12 karaktere, durum 32 karaktere kırpılır', () => {
  const o = ozetCikar({ motorSurumu: { sha12: 'a'.repeat(40), durum: 'd'.repeat(50) } });
  assert.strictEqual(o.motorSha12.length, 12);
  assert.strictEqual(o.motorDurum.length, 32);
});

test('paketJsondanOku: paket.json var → alan eşlemesi', async () => {
  const d = gecici();
  fs.writeFileSync(path.join(d, 'paket.json'), JSON.stringify({
    motorSurumu: { sha12: '0123456789ab', durum: 'guncel' },
    kabukSurumu: { durum: 'karisik', kanonikSurum: '3.0.0' },
  }));
  assert.deepStrictEqual(await paketJsondanOku(d), {
    motorSha12: '0123456789ab', motorDurum: 'guncel', kabukSurum: '3.0.0', kabukDurum: 'karisik',
  });
});

test('paketJsondanOku: paket.json yok → hepsi null, fırlatmaz', async () => {
  assert.deepStrictEqual(await paketJsondanOku(gecici()), BOS);
  assert.deepStrictEqual(await paketJsondanOku('/yok/olan/dizin'), BOS);
});

test('paketJsondanOku: bozuk JSON → hepsi null, fırlatmaz', async () => {
  const d = gecici();
  fs.writeFileSync(path.join(d, 'paket.json'), '{bozuk');
  assert.deepStrictEqual(await paketJsondanOku(d), BOS);
});

test('paketJsondanOku: dizin olarak geçersiz girdi (undefined) fırlatmaz', async () => {
  assert.deepStrictEqual(await paketJsondanOku(undefined), BOS);
});

test('bosOzet her çağrıda yeni nesne', () => {
  assert.notStrictEqual(bosOzet(), bosOzet());
});

test('govdeAlanlari: null alanlar atlanır, dolu olanlar geçer', () => {
  assert.deepStrictEqual(govdeAlanlari({ ...BOS, motorSha12: 'abc', kabukDurum: 'guncel' }),
    { motorSha12: 'abc', kabukDurum: 'guncel' });
  assert.deepStrictEqual(govdeAlanlari(BOS), {});
  assert.deepStrictEqual(govdeAlanlari(null), {});
  assert.deepStrictEqual(govdeAlanlari(undefined), {});
});

// SENTİNEL — runner.js doğru yerde bağlandı (tam akış R2/curl IO ister; repo konvansiyonu).
const RUNNER = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
const FN = RUNNER.slice(
  RUNNER.indexOf('async function postResultSuccess'),
  RUNNER.indexOf('async function postResultFailure'),
);

test('postResultSuccess: /result gövdesine kanonik sürüm alanları eklenir', () => {
  const post = FN.slice(FN.indexOf('axios.post('));
  assert.match(post, /\.\.\.kanonikGovdeAlanlari\(job\.kanonikSurum\)/);
  assert.match(RUNNER, /require\(['"]\.\/kanonik-surum['"]\)/);
});

test('runner: poll sonucundaki kanonikSurum job.kanonikSurum\'a taşınır (paketleyici yolu)', () => {
  assert.match(RUNNER,
    /job\.kanonikSurum = \(pollSonuclari && pollSonuclari\.kanonikSurum\) \|\| null;/);
  assert.ok(RUNNER.indexOf('job.kanonikSurum =') < RUNNER.indexOf('await packagerDownload('),
    'atama indirmeden önce olmalı');
});

test('packagingService: paket.json damgalarından sonra results.kanonikSurum yazılır', () => {
  const svc = fs.readFileSync(path.join(__dirname, '..', 'packaging', 'packagingService.js'), 'utf8');
  const i = svc.indexOf('results.kanonikSurum = await kanonikSurumOzeti.paketJsondanOku(workingPath)');
  assert.ok(i > svc.indexOf('kabukSurumu: kabukDamgasiSonucu'), 'kabuk damgasından sonra');
});

// Davranışsal: paket.json → özet → gövde alanları, uçtan uca.
test('uçtan uca: paket.json → özet → /result gövdesi alanları', async () => {
  const d = gecici();
  fs.writeFileSync(path.join(d, 'paket.json'), JSON.stringify({
    motorSurumu: { sha12: 'fedcba987654', durum: 'guncel' },
    kabukSurumu: { durum: 'guncel', kanonikSurum: '1.2.3' },
  }));
  assert.deepStrictEqual(govdeAlanlari(await paketJsondanOku(d)), {
    motorSha12: 'fedcba987654', motorDurum: 'guncel', kabukSurum: '1.2.3', kabukDurum: 'guncel',
  });
});

// PARDUS yolu: paket.json konteynerde; log damgalarından aynı özet.
const PARDUS_LOG = [
  'bir şey',
  '📖 Okuyucu kabuğu: guncel, 3 kitap değişti (kanonik 1.13.3)',
  'EMPP_MOTOR durum=guncel sha12=abcdef012345 kanonik=abcdef012345 surum=2.0 degisen=1',
].join('\n');

test('logdanOzet: Pardus packager.log → dört alan', () => {
  assert.deepStrictEqual(logdanOzet(PARDUS_LOG), {
    motorSha12: 'abcdef012345', motorDurum: 'guncel', kabukSurum: '1.13.3', kabukDurum: 'guncel',
  });
});

test('logdanOzet: kanonik YOK / sha12 "-" / boş log → null, fırlatmaz', () => {
  assert.deepStrictEqual(
    logdanOzet('Okuyucu kabuğu: bilinmiyor, 0 kitap değişti (kanonik YOK)\nEMPP_MOTOR durum=bilinmiyor sha12=- kanonik=YOK'),
    { motorSha12: null, motorDurum: 'bilinmiyor', kabukSurum: null, kabukDurum: 'bilinmiyor' });
  for (const g of ['', null, undefined, 5]) assert.deepStrictEqual(logdanOzet(g), BOS);
});

test('runner pardus yolu: packager.log → job.kanonikSurum → /result gövdesi (sentinel + davranış)', () => {
  const pf = RUNNER.slice(RUNNER.indexOf('async function buildPardusArtifact'),
    RUNNER.indexOf('async function', RUNNER.indexOf('async function buildPardusArtifact') + 10));
  assert.match(pf, /kimlik\.kanonikHedef\.kanonikSurum = kanonikLogdanOzet\(packagerLogMetni\)/);
  assert.match(RUNNER, /kanonikHedef: job,/);
  const job = { kanonikSurum: null };
  job.kanonikSurum = logdanOzet(PARDUS_LOG);
  assert.deepStrictEqual(govdeAlanlari(job.kanonikSurum), {
    motorSha12: 'abcdef012345', motorDurum: 'guncel', kabukSurum: '1.13.3', kabukDurum: 'guncel',
  });
});
