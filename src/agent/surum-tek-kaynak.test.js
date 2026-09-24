'use strict';

/**
 * @fileoverview SÖZLEŞME TESTİ — sürüm kıyası TEK KAYNAKTAN gelir.
 *
 * NEDEN VAR (2026-09-21, kardeş kör noktası):
 * Bu depoda tekrarlayan bir hata sınıfı var — "tek yolda onarım kardeş yolları
 * kör bırakır". Sürüm kıyası tam olarak bunu yaşadı: aynı karar ("elimizdeki
 * sürüm bayat mı?") ÜÇ ayrı uçta veriliyordu —
 *
 *   1. `runner.js:cachedZipIsStale`      (okuyan uç — kaynak önbelleği)
 *   2. `publisher-update.js:isNewer`     (yazan uç  — güncellemeyi uygula)
 *   3. `local-build.js:zipStale`         (yerel hat — okuyan uç kardeşi)
 *
 * (1) onarıldı, (2) ve (3) dokunulmadan kaldı; ölçüldüğünde (2) aynı ~350 MB
 * zip'i HER işte yeniden açıyor, (3) HER işte ~1 GB kaynağı yeniden indiriyordu.
 *
 * Bu dosya iki kapı kurar:
 *   A) DAVRANIŞ KAPISI — dışa açık her kıyas ucu, `surum-kiyas` ile BİREBİR
 *      aynı kararı vermek zorunda (uç kendi gövdesini yeniden yazsa bile kırılır).
 *   B) KAYNAK KAPISI  — `src/agent/` içinde sürüm kararı veren yeni bir dosya
 *      `surum-kiyas`'ı ithal etmeden kendi mantığını kurarsa test kırılır.
 *
 * (B) saf bir kaynak taraması olduğu için kırılgan olabilir; bu yüzden
 * dedektörün KENDİSİ de sentetik girdilerle test edilir (aşağıda) — hiç
 * ateşlemeyen bir bekçi, bekçi değildir.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { dahaYeniMi, ayniSurumMu } = require('./surum-kiyas');
const { isNewer, latestLocalUpdate } = require('./publisher-update');

/** Gerçek sahadan gelen sürümler + kenar durumlar. */
const SURUMLER = [
  '1', '1.0.0', '1.9.0', '1.10.0', '1.11.5',
  '1.13.1', '1.13.1.3', '1.13.1.4', '1.13.2', '1.13.8', '2.0.0',
];

// ───────────────────────────────────────────────────────────────────────────
// A) DAVRANIŞ KAPISI — uçlar tek kaynakla aynı kararı verir
// ───────────────────────────────────────────────────────────────────────────

test('SÖZLEŞME: publisher-update.isNewer, surum-kiyas.dahaYeniMi ile birebir aynıdır', () => {
  const ayrisan = [];
  for (const a of SURUMLER) {
    for (const b of SURUMLER) {
      if (isNewer(a, b) !== dahaYeniMi(a, b)) ayrisan.push(`${a} → ${b}`);
    }
  }
  assert.deepStrictEqual(
    ayrisan, [],
    'isNewer kendi kıyas mantığını kurmuş — sürüm kıyası YALNIZ surum-kiyas.js\'te yaşar',
  );
});

test('SÖZLEŞME: isNewer belirsiz/bozuk girdide "yeni" demez (fail-safe tek kaynaktan)', () => {
  for (const bozuk of [undefined, null, '', '   ', 'abc', 'v1.2.3', '1.2.3-beta', 42, {}]) {
    assert.strictEqual(isNewer(bozuk, '9.9.9'), false, `isNewer(${JSON.stringify(bozuk)}, '9.9.9')`);
    assert.strictEqual(isNewer('1.0.0', bozuk), false, `isNewer('1.0.0', ${JSON.stringify(bozuk)})`);
  }
});

test('SÖZLEŞME: normalleştirme sonrası tekrar-uygulama kapısı kapalı', () => {
  // Sahadaki asıl vaka: version.txt "1.13.1"e normalleştirildi, zip adı
  // "1.13.1.3" kaldı. Bu çift "yeni" sayılırsa her iş 350 MB'ı yeniden açar.
  assert.strictEqual(isNewer('1.13.1', '1.13.1.3'), false);
  assert.strictEqual(ayniSurumMu('1.13.1', '1.13.1.3'), true);
  // ama gerçek ilerleme hâlâ görülmeli:
  assert.strictEqual(isNewer('1.13.1', '1.13.8'), true);
  assert.strictEqual(isNewer('1.13.1.3', '1.13.1.4'), true);
});

test('SÖZLEŞME (bilinçli İSTİSNA): zip adı sıralaması TAM DERİNLİK kalır', () => {
  // `latestLocalUpdate` ham dosya adlarını sıralar; orada 4. parça GERÇEK
  // bilgidir (iki ayrı dosya). Kanonik kıyasa bağlanırsa "1.13.1.3" ile
  // "1.13.1.5" eşitlenir ve seçim readdir sırasına kalır — belirsizleşir.
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'tek-kaynak-upd-'));
  const dizin = path.join(kok, '060');
  fs.mkdirSync(dizin, { recursive: true });
  for (const v of ['1.12.0', '1.13.1', '1.13.1.3', '1.13.1.5']) {
    fs.writeFileSync(path.join(dizin, v + '.zip'), 'x');
  }
  assert.strictEqual(latestLocalUpdate('060', kok).version, '1.13.1.5');
});

test('SÖZLEŞME: uçtan uca — aynı zip ikinci kez uygulanmaz (350 MB tekrarı)', () => {
  const zipVar = spawnSync('zip', ['-v'], { encoding: 'utf8' }).status === 0;
  if (!zipVar) return; // zip yoksa ölçüm yapılamaz — sessiz "geçti" değil, atlanır
  const { applyPublisherUpdate } = require('./publisher-update');
  const build = fs.mkdtempSync(path.join(os.tmpdir(), 'tek-kaynak-build-'));
  fs.writeFileSync(path.join(build, 'kurum.txt'), '60\r\n');
  fs.writeFileSync(path.join(build, 'version.txt'), '1.11.5');
  fs.writeFileSync(path.join(build, 'app.config.js'), '// eski');
  const updRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tek-kaynak-upd2-'));
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'tek-kaynak-src-'));
  fs.writeFileSync(path.join(src, 'app.config.js'), '// yeni');
  fs.writeFileSync(path.join(src, 'version.txt'), '1.13.1.3');
  fs.mkdirSync(path.join(updRoot, '060'), { recursive: true });
  spawnSync('zip', ['-q', '-r', path.join(updRoot, '060', '1.13.1.3.zip'), '.'], { cwd: src });

  assert.strictEqual(applyPublisherUpdate(build, { updateDir: updRoot }).applied, true);
  const ikinci = applyPublisherUpdate(build, { updateDir: updRoot });
  assert.strictEqual(ikinci.applied, false, 'ikinci koşu iş yapmamalı');
  assert.strictEqual(ikinci.reason, 'zaten güncel');
});

// ───────────────────────────────────────────────────────────────────────────
// B) KAYNAK KAPISI — yeni bir kardeş kendi mantığını kuramaz
// ───────────────────────────────────────────────────────────────────────────

/**
 * Bir dosya sürüm KARARI veriyor mu? (saf — I/O yok, sentetik girdiyle test edilir)
 *
 * İki işaret:
 *  - `version.txt` referansı: bu depoda sürüm kararının tek girdi kaynağı odur.
 *  - elde ayrıştırma: `split('.')` + `parseInt(` aynı dosyada — hand-rolled
 *    kıyaslayıcının imzası (`surum-normallestir` yalnız `/^\d+$/` testi yapar,
 *    `parseInt` kullanmaz; bu yüzden bu ikili ayırt edicidir).
 *
 * @param {string} kaynak
 * @returns {boolean}
 */
function surumKarariVeriyorMu(kaynak) {
  if (/version\.txt/.test(kaynak)) return true;
  return /split\(\s*['"]\.['"]\s*\)/.test(kaynak) && /parseInt\s*\(/.test(kaynak);
}

/** @param {string} kaynak */
function tekKaynagiIthalEdiyorMu(kaynak) {
  return /require\(\s*['"]\.\/surum-kiyas['"]\s*\)/.test(kaynak);
}

/**
 * MUAF dosyalar — her biri GEREKÇELİ. Listeye eklemek bilinçli bir karardır;
 * gerekçesiz eklenen satır bu testin anlamını boşaltır.
 */
const MUAF = {
  'surum-kiyas.js': 'kanonun kendisi — kıyas burada yaşar',
  'surum-normallestir.js': 'normalleştirici; sürüm BİÇİMİNİ düzeltir, KIYAS yapmaz',
};

test('dedektör kendisi çalışıyor mu? (bekçi tatbikatı — sentetik girdiler)', () => {
  // Ateşlemeli: elde yazılmış kıyaslayıcı
  assert.strictEqual(surumKarariVeriyorMu(
    "function cmp(a,b){const p=a.split('.');return parseInt(p[0],10);}"), true);
  // Ateşlemeli: version.txt kararı
  assert.strictEqual(surumKarariVeriyorMu(
    "const v = read('version.txt') || '1';"), true);
  // Ateşlememeli: alakasız dosya
  assert.strictEqual(surumKarariVeriyorMu(
    "const ext = filePath.split('.').pop().toLowerCase();"), false);
  assert.strictEqual(surumKarariVeriyorMu("const n = parseInt(satir, 10);"), false);
  // İthal dedektörü
  assert.strictEqual(tekKaynagiIthalEdiyorMu("const {dahaYeniMi}=require('./surum-kiyas');"), true);
  assert.strictEqual(tekKaynagiIthalEdiyorMu("const x=require('./publisher-update');"), false);
});

test('SÖZLEŞME: src/agent içinde sürüm kararı veren her dosya surum-kiyas ithal eder', () => {
  const dizin = __dirname;
  const dosyalar = fs.readdirSync(dizin)
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
  assert.ok(dosyalar.length >= 5, 'tarama boş döndü — dedektör yanlış yere bakıyor');

  const ihlaller = [];
  for (const f of dosyalar) {
    if (Object.prototype.hasOwnProperty.call(MUAF, f)) continue;
    const kaynak = fs.readFileSync(path.join(dizin, f), 'utf8');
    if (surumKarariVeriyorMu(kaynak) && !tekKaynagiIthalEdiyorMu(kaynak)) ihlaller.push(f);
  }
  assert.deepStrictEqual(
    ihlaller, [],
    'bu dosya(lar) sürüm kararı veriyor ama surum-kiyas ithal etmiyor — ' +
    "kardeş kör noktası. Kıyası kendin yazma: require('./surum-kiyas').",
  );
});

test('SÖZLEŞME: bilinen üç uç gerçekten tek kaynağa bağlı', () => {
  // Muafiyet listesi büyüyerek testi boşaltamasın diye uçlar İSİMLE çivili.
  for (const f of ['publisher-update.js', 'local-build.js', 'runner.js']) {
    const kaynak = fs.readFileSync(path.join(__dirname, f), 'utf8');
    assert.ok(tekKaynagiIthalEdiyorMu(kaynak), `${f} surum-kiyas ithal etmiyor`);
  }
});

test('SÖZLEŞME: muafiyet listesi dar ve gerekçeli kalır', () => {
  assert.deepStrictEqual(Object.keys(MUAF).sort(), ['surum-kiyas.js', 'surum-normallestir.js']);
  for (const [dosya, gerekce] of Object.entries(MUAF)) {
    assert.ok(gerekce && gerekce.length > 20, `${dosya} için gerekçe yetersiz`);
  }
  // Muaf normalleştirici gerçekten kıyas yapmıyor olmalı (muafiyetin kanıtı):
  const norm = fs.readFileSync(path.join(__dirname, 'surum-normallestir.js'), 'utf8');
  assert.strictEqual(/parseInt\s*\(/.test(norm), false,
    'surum-normallestir kıyaslamaya başladıysa muafiyeti geçersizdir');
  const disaAcik = Object.keys(require('./surum-normallestir'));
  assert.deepStrictEqual(disaAcik.sort(), ['acikMi', 'ucParcayaCevir', 'yazilacakSurum'],
    'normalleştirici yeni bir kıyas fonksiyonu dışa açmış olabilir');
});
