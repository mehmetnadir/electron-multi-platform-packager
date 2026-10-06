'use strict';
/**
 * Okuyucu sürümü kapısı (06.10 A1 olayı): paketteki okuyucu kabuğu kanonikle EŞİT mi?
 * Fikstürler gerçek kabuk biçimini taklit eder: index.html → `<h20>.main.js` → (parça) `e.exports={i8:"X"}`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const K = require('./okuyucu-surumu-kapisi');
const A1 = require('../../src/packaging/a1-duzen');

const KANONIK = '1.13.14';
const MAIN = 'a1b2c3d4e5f6a7b8c9d0.main.js';
const PARCA_H = 'ffeeddccbbaa99887766';
const CLI = path.join(__dirname, 'okuyucu-surumu-kapisi.js');

function gecici(ad) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `osk-test-${ad}-`));
}

/** Kabuk dosyaları: main.js rozeti ya doğrudan taşır ya da parçaya (`<h20>.<id>.js`) yönlendirir. */
function kabukYaz(dir, surum, { parcali = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  if (parcali) {
    fs.writeFileSync(path.join(dir, MAIN), `/* webpack */ var m={77:"${PARCA_H}"};`);
    fs.writeFileSync(path.join(dir, `${PARCA_H}.77.js`), `(function(e){e.exports={i8:"${surum}"}})({});`);
  } else {
    fs.writeFileSync(path.join(dir, MAIN), `(function(e){e.exports={i8:"${surum}"}})({});`);
  }
}

const OKUYUCU_SAYFASI = `<!doctype html><html><head><title>Akıllı Tahta Uygulaması</title>`
  + `<script defer="defer" src="./${MAIN}"></script></head><body><div id="root"></div></body></html>`;
const SET_KABUGU = '<!doctype html><html><head><title>Set</title></head><body><a href="kapak/index.html?kapak=1">1</a></body></html>';

/** A1 düzeni: kök sf425 kabuğu (main.js ÇAĞIRMAZ) + kapak/index.html (A1 başlıklı) + kök kabuk. */
function a1Agaci(surum, { parcali = true, imwin = true } = {}) {
  const d = gecici('a1');
  fs.writeFileSync(path.join(d, 'index.html'), SET_KABUGU);
  fs.writeFileSync(path.join(d, 'app.config.js'), 'window.AppConfig={};');
  if (imwin) {
    fs.mkdirSync(path.join(d, 'classlibraries'));
    fs.writeFileSync(path.join(d, 'classlibraries', 'ImWin32.dll'), 'x');
  }
  fs.mkdirSync(path.join(d, 'kapak'));
  fs.writeFileSync(path.join(d, ...A1.A1_MOTOR_SAYFASI.split('/')), A1.baslikEkle(OKUYUCU_SAYFASI));
  if (surum) kabukYaz(d, surum, { parcali });
  return d;
}

/** bookN SET: her kitap kendi kabuğuyla. `null` sürüm = okuyucusuz kitap (yalnız PDF). */
function setAgaci(surumler) {
  const d = gecici('set');
  fs.writeFileSync(path.join(d, 'index.html'), SET_KABUGU);
  surumler.forEach((s, i) => {
    const b = path.join(d, `book${i + 1}`);
    fs.mkdirSync(b);
    if (s === null) { fs.writeFileSync(path.join(b, 'kitap.pdf'), '%PDF'); return; }
    fs.writeFileSync(path.join(b, 'index.html'), OKUYUCU_SAYFASI);
    fs.writeFileSync(path.join(b, 'app.config.js'), 'window.AppConfig={};');
    kabukYaz(b, s, { parcali: i % 2 === 1 });
  });
  return d;
}

const temizle = (...d) => { for (const x of d) fs.rmSync(x, { recursive: true, force: true }); };
const ZORUNLU = { KABUL_OKUYUCU_SURUM: '' };
const UYAR = { KABUL_OKUYUCU_SURUM: 'uyar' };

test('A1 eski okuyucu (1.13.3, 45496 biçimi) → RED; ölçülen sayfa kapak/index.html', async () => {
  const d = a1Agaci('1.13.3');
  try {
    const r = await K.okuyucuSurumuOlc(d, { kanonik: KANONIK, env: ZORUNLU });
    assert.equal(r.karar, 'RED');
    assert.equal(r.olculen, '1.13.3');
    assert.equal(r.kanonik, KANONIK);
    assert.equal(r.birimler.length, 1);
    assert.equal(r.birimler[0].sayfa, 'kapak/index.html');
    assert.equal(r.birimler[0].duzen, 'a1');
    assert.equal(r.birimler[0].karar, 'eski');
    assert.match(r.sebepler.join(' | '), /kapak\/index\.html: okuyucu 1\.13\.3 < kanonik 1\.13\.14/);
    assert.equal(K.gecerMi(r), false);
  } finally { temizle(d); }
});

test('A1 güncel okuyucu → GEÇTİ (kök sf425 index main.js çağırmasa da)', async () => {
  const d = a1Agaci(KANONIK);
  try {
    const r = await K.okuyucuSurumuOlc(d, { kanonik: KANONIK, env: ZORUNLU });
    assert.equal(r.karar, 'GECTI', JSON.stringify(r));
    assert.equal(r.olculen, KANONIK);
    assert.equal(r.birimler[0].parca, `${PARCA_H}.77.js`);
    assert.deepEqual(r.sebepler, []);
  } finally { temizle(d); }
});

test('A1 işaretli ama kökte ImWin32.dll yok (bozuk düzen) → ÖLÇÜLEMEDİ, kapı geçirmez', async () => {
  const d = a1Agaci(KANONIK, { imwin: false });
  try {
    const r = await K.okuyucuSurumuOlc(d, { kanonik: KANONIK, env: ZORUNLU });
    assert.equal(r.karar, 'OLCULEMEDI');
    assert.match(r.sebepler.join(' | '), /A1 düzeni bozuk/);
    assert.equal(K.gecerMi(r), false);
  } finally { temizle(d); }
});

test('bookN karışık (book2 eski) → RED; sebep eski kitabı adlandırır', async () => {
  const d = setAgaci([KANONIK, '1.13.3', KANONIK]);
  try {
    const r = await K.okuyucuSurumuOlc(d, { kanonik: KANONIK, env: ZORUNLU });
    assert.equal(r.karar, 'RED');
    assert.equal(r.olculen, `${KANONIK},1.13.3`);
    assert.deepEqual(r.birimler.map((b) => b.karar), ['ayni', 'eski', 'ayni']);
    assert.match(r.sebepler.join(' | '), /book2\/index\.html: okuyucu 1\.13\.3/);
  } finally { temizle(d); }
});

test('bookN hepsi kanonik + okuyucusuz kitap (yalnız PDF) → GEÇTİ, okuyucusuz kabuksuz sayılır', async () => {
  const d = setAgaci([KANONIK, KANONIK, null]);
  try {
    const r = await K.okuyucuSurumuOlc(d, { kanonik: KANONIK, env: ZORUNLU });
    assert.equal(r.karar, 'GECTI', JSON.stringify(r));
    assert.deepEqual(r.birimler.map((b) => b.karar), ['ayni', 'ayni', 'kabuksuz']);
  } finally { temizle(d); }
});

test('kanonikten YENİ okuyucu → RED (eşitlik ister; kasa bayatKarari ile aynı ölçüt)', async () => {
  const d = setAgaci(['1.14.0']);
  try {
    const r = await K.okuyucuSurumuOlc(d, { kanonik: KANONIK, env: ZORUNLU });
    assert.equal(r.karar, 'RED');
    assert.match(r.sebepler[0], /1\.14\.0 > kanonik/);
  } finally { temizle(d); }
});

test('okuyucu sayfası yok (boş paket kökü) → ÖLÇÜLEMEDİ, CLI çıkışı 1 (fail-closed)', async () => {
  const d = gecici('bos');
  try {
    const r = await K.okuyucuSurumuOlc(d, { kanonik: KANONIK, env: ZORUNLU });
    assert.equal(r.karar, 'OLCULEMEDI');
    assert.match(r.sebepler.join(' | '), /index\.html yok/);
    const c = await K.calis([d, '--kanonik', KANONIK], () => {}, ZORUNLU);
    assert.equal(c.kod, 1);
  } finally { temizle(d); }
});

test('kök sayfa main.js çağırmıyor (A1 işaretsiz set kabuğu = olay öncesi yanlış ölçüm) → ÖLÇÜLEMEDİ', async () => {
  const d = gecici('kabuksuz-kok');
  fs.writeFileSync(path.join(d, 'index.html'), SET_KABUGU);
  try {
    const r = await K.okuyucuSurumuOlc(d, { kanonik: KANONIK, env: ZORUNLU });
    assert.equal(r.karar, 'OLCULEMEDI');
    assert.match(r.sebepler.join(' | '), /ana girişini \(\*\.main\.js\) çağırmıyor/);
  } finally { temizle(d); }
});

test('main.js eksik ya da rozetsiz → ÖLÇÜLEMEDİ, sebep dosyayı adlandırır', async () => {
  const d = setAgaci([KANONIK, KANONIK]);
  fs.renameSync(path.join(d, 'book1', MAIN), path.join(d, 'book1', 'kayip.txt'));
  fs.writeFileSync(path.join(d, 'book2', MAIN), 'console.log("rozet yok")');
  try {
    const r = await K.okuyucuSurumuOlc(d, { kanonik: KANONIK, env: ZORUNLU });
    assert.equal(r.karar, 'OLCULEMEDI');
    const s = r.sebepler.join(' | ');
    assert.match(s, new RegExp(`book1/index\\.html: ${MAIN.replace(/\./g, '\\.')} yok`));
    assert.match(s, /book2\/index\.html: .* sürüm rozeti \(i8\) yok/);
  } finally { temizle(d); }
});

test('RED, ÖLÇÜLEMEDİ\'den önce gelir (bir kitap eski + bir kitap ölçülemez → RED)', async () => {
  const d = setAgaci(['1.13.3', KANONIK]);
  fs.writeFileSync(path.join(d, 'book2', MAIN), 'rozetsiz');
  try {
    const r = await K.okuyucuSurumuOlc(d, { kanonik: KANONIK, env: ZORUNLU });
    assert.equal(r.karar, 'RED');
  } finally { temizle(d); }
});

test('kanonik bilinmiyor (kanonik.json yok / biçim dışı) → ÖLÇÜLEMEDİ', async () => {
  const d = setAgaci([KANONIK]);
  const k = gecici('kanonik');
  try {
    const yok = await K.okuyucuSurumuOlc(d, { kanonikYol: path.join(k, 'yok.json'), env: ZORUNLU });
    assert.equal(yok.karar, 'OLCULEMEDI');
    assert.match(yok.sebepler[0], /kanonik okuyucu sürümü bilinmiyor \(kanonik\.json okunamadı/);
    fs.writeFileSync(path.join(k, 'kanonik.json'), JSON.stringify({ surum: KANONIK, dizin: KANONIK }));
    const var_ = await K.okuyucuSurumuOlc(d, { kanonikYol: path.join(k, 'kanonik.json'), env: ZORUNLU });
    assert.equal(var_.karar, 'GECTI');
    assert.equal(var_.kanonikKaynagi, path.join(k, 'kanonik.json'));
    const bicim = await K.okuyucuSurumuOlc(d, { kanonik: 'abc', env: ZORUNLU });
    assert.equal(bicim.karar, 'OLCULEMEDI');
  } finally { temizle(d, k); }
});

test('KABUL_OKUYUCU_SURUM=uyar → eski okuyucu GEÇTİ + uyarı; ham karar RED korunur', async () => {
  const d = a1Agaci('1.13.3');
  try {
    const r = await K.okuyucuSurumuOlc(d, { kanonik: KANONIK, env: UYAR });
    assert.equal(r.karar, 'GECTI');
    assert.equal(r.hamKarar, 'RED');
    assert.equal(r.kip, 'uyar');
    assert.match(r.uyari, /yalnız uyarı/);
    assert.equal(K.gecerMi(r), true);
    const c = await K.calis([d, '--kanonik', KANONIK], () => {}, UYAR);
    assert.equal(c.kod, 0);
  } finally { temizle(d); }
});

test('paket.json damgası "guncel" ama ölçüm eski → RED + "damga kanıt değildir" notu', async () => {
  const d = a1Agaci('1.13.3');
  fs.writeFileSync(path.join(d, 'paket.json'), JSON.stringify({ kabukSurumu: { durum: 'guncel', kanonikSurum: KANONIK } }));
  try {
    const r = await K.okuyucuSurumuOlc(d, { kanonik: KANONIK, env: ZORUNLU });
    assert.equal(r.karar, 'RED');
    assert.deepEqual(r.damga, { durum: 'guncel', kanonikSurum: KANONIK });
    assert.match(r.sebepler.join(' | '), /damga kanıt değildir/);
  } finally { temizle(d); }
});

test('asar (mac/pardus/windows): A1 eski asar → RED, güncel asar → GEÇTİ (yalnız gereken dosyalar çıkar)', async () => {
  const asar = require('@electron/asar');
  const kaynakEski = a1Agaci('1.13.3');
  const kaynakYeni = setAgaci([KANONIK, null]);
  fs.mkdirSync(path.join(kaynakEski, 'assets'));
  fs.writeFileSync(path.join(kaynakEski, 'assets', 'buyuk.bin'), Buffer.alloc(1024));
  const cikti = gecici('asar');
  try {
    const eski = path.join(cikti, 'eski.asar');
    const yeni = path.join(cikti, 'yeni.asar');
    await asar.createPackage(kaynakEski, eski);
    await asar.createPackage(kaynakYeni, yeni);
    const calisma = path.join(cikti, 'calisma');
    const r1 = await K.okuyucuSurumuOlc(eski, { asar: true, kanonik: KANONIK, calisma, env: ZORUNLU });
    assert.equal(r1.karar, 'RED', JSON.stringify(r1));
    assert.equal(r1.birimler[0].sayfa, 'kapak/index.html');
    assert.ok(!fs.existsSync(path.join(calisma, 'okuyucu-surumu', 'assets')), 'assets/ çıkarılmamalı');
    const r2 = await K.okuyucuSurumuOlc(yeni, { kanonik: KANONIK, env: ZORUNLU }); // .asar uzantısından anlar
    assert.equal(r2.karar, 'GECTI', JSON.stringify(r2));
    assert.deepEqual(r2.birimler.map((b) => b.karar), ['ayni', 'kabuksuz']);
  } finally { temizle(kaynakEski, kaynakYeni, cikti); }
});

test('asarGerekliMi: yalnız ölçüm dosyaları (saf)', () => {
  for (const y of ['index.html', 'kapak/index.html', 'app.config.js', 'classlibraries/ImWin32.dll', 'paket.json',
    MAIN, `${PARCA_H}.77.js`, 'book3/index.html', `book3/${MAIN}`, '0123456789abcdef0123.js']) {
    assert.equal(K.asarGerekliMi(y), true, y);
  }
  for (const y of ['assets/a.png', 'kapak/x.js', `pages/${MAIN}`, 'book3/assets/index.html', 'main.js', 'book3/core/index.html']) {
    assert.equal(K.asarGerekliMi(y), false, y);
  }
});

test('kararVer (saf): okuyucu birimi yok → ÖLÇÜLEMEDİ; hepsi kabuksuz → ÖLÇÜLEMEDİ', () => {
  assert.equal(K.kararVer([], KANONIK).karar, 'OLCULEMEDI');
  assert.equal(K.kararVer([{ karar: 'kabuksuz' }], KANONIK).karar, 'OLCULEMEDI');
  assert.equal(K.kararVer([{ karar: 'ayni' }], null).karar, 'OLCULEMEDI');
  assert.equal(K.kararVer([{ karar: 'ayni' }, { karar: 'kabuksuz' }], KANONIK).karar, 'GECTI');
  assert.equal(K.kip({ KABUL_OKUYUCU_SURUM: 'UYAR ' }), 'uyar');
  assert.equal(K.kip({ KABUL_OKUYUCU_SURUM: '0' }), 'zorunlu');
});

test('CLI (gerçek süreç): çıkış 0 GEÇTİ · 1 RED · 2 kullanım; --json ayrıştırılır', () => {
  const iyi = a1Agaci(KANONIK);
  const kotu = setAgaci([KANONIK, '1.13.3']);
  const env = { ...process.env, KABUL_OKUYUCU_SURUM: '' };
  try {
    const a = spawnSync(process.execPath, [CLI, iyi, '--kanonik', KANONIK], { encoding: 'utf8', env });
    assert.equal(a.status, 0, a.stdout + a.stderr);
    assert.match(a.stdout, /^OKUYUCU_KARAR=GECTI$/m);
    assert.match(a.stdout, /^OKUYUCU_OLCULEN=1\.13\.14$/m);
    const b = spawnSync(process.execPath, [CLI, kotu, '--kanonik', KANONIK, '--json'], { encoding: 'utf8', env });
    assert.equal(b.status, 1, b.stdout + b.stderr);
    const j = JSON.parse(b.stdout);
    assert.equal(j.karar, 'RED');
    assert.equal(j.birimler[1].sayfa, 'book2/index.html');
    const c = spawnSync(process.execPath, [CLI], { encoding: 'utf8', env });
    assert.equal(c.status, 2);
    const d = spawnSync(process.execPath, [CLI, '/yok/boyle/bir/kok'], { encoding: 'utf8', env });
    assert.equal(d.status, 2);
    const e = spawnSync(process.execPath, [CLI, kotu, '--kanonik', KANONIK], {
      encoding: 'utf8', env: { ...env, KABUL_OKUYUCU_SURUM: 'uyar' },
    });
    assert.equal(e.status, 0, e.stdout + e.stderr);
    assert.match(e.stdout, /^OKUYUCU_HAM_KARAR=RED$/m);
  } finally { temizle(iyi, kotu); }
});

test('CLI: paket dosyası açılamazsa ÖLÇÜLEMEDİ → çıkış 1 (fail-closed)', async () => {
  const d = gecici('bozuk-paket');
  const f = path.join(d, 'bozuk.zip');
  fs.writeFileSync(f, 'zip değil');
  const satirlar = [];
  try {
    const r = await K.calis([f, '--kanonik', KANONIK], (s) => satirlar.push(s), ZORUNLU);
    assert.equal(r.kod, 1, satirlar.join('\n'));
    assert.equal(r.sonuc.karar, 'OLCULEMEDI');
  } finally { temizle(d); }
});
