'use strict';
// AppRun'ın sürüm-farkındalıklı yeniden kurulumunu GERÇEKTEN KOŞARAK doğrular.
//
// Saha dersi (2026-09-10, Flashy set, ProBook): AppRun paketi ~/DijiTap altına bir kez
// kuruyor, kuruluysa dosyaları tazelemeden eski kopyayı çalıştırıyordu → düzeltilmiş
// .impark'ı indiren müşteri hâlâ eskisini görüyordu ("Kitap Güncelleniyor %0").
//
// Bu test şablon METNİNDE ARAMAZ (yorum tuzağı): şablonu sahte HOME + sahte AppDir +
// sahte ürün ikilisi (echo) + sahte zenity ile bash'te koşturur, dosya sisteminin
// sonucuna bakar. Ürün ikilisi ürün adıyla (+ .desktop) paketlenir; böylece önceki
// düzeltme (resolve_executable, sabit ad kusuru) de aynı koşuda doğrulanır.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TEMPLATE = path.join(__dirname, 'apprun-template.sh');
const APP = 'flashy-set';
const PUB = 'Flashy';
const ESKI_ZAMAN = new Date('2026-01-01T00:00:00Z');

// Şablon /usr/bin/zenity varsa onu tercih eder; sahte zenity ancak yoksa devreye girer.
const GERCEK_ZENITY_VAR = fs.existsSync('/usr/bin/zenity');

function ortam() {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'apprun-surum-'));
  const home = path.join(kok, 'home');
  fs.mkdirSync(home);
  return { kok, home };
}

// AppDir: değişkenleri yerleştirilmiş AppRun + ürün ikilisi + .desktop + sahte zenity.
function sahteAppDir(kok, surum, etiket) {
  const dir = path.join(kok, `appdir-${etiket}`);
  fs.mkdirSync(path.join(dir, 'usr', 'bin'), { recursive: true });
  const src = fs.readFileSync(TEMPLATE, 'utf8')
    .replace(/\{\{APP_NAME\}\}/g, APP)
    .replace(/\{\{APP_VERSION\}\}/g, surum)
    .replace(/\{\{PUBLISHER_NAME\}\}/g, PUB)
    .replace(/\{\{PUBLISHER_ID\}\}/g, '42');
  fs.writeFileSync(path.join(dir, 'AppRun'), src, { mode: 0o755 });
  // Ürün ikilisi: gerçekte ELF; burada kim olduğunu, yolunu ve argümanlarını basan betik.
  fs.writeFileSync(path.join(dir, APP), `#!/bin/bash\necho "CALISTI ${etiket} $0 $*"\n`,
    { mode: 0o755 });
  fs.writeFileSync(path.join(dir, `${APP}.desktop`), '[Desktop Entry]\n');
  // Sahte zenity: her çağrıyı günlüğe yazar, --progress'te stdin'i tüketir.
  fs.writeFileSync(path.join(dir, 'usr', 'bin', 'zenity'),
    '#!/bin/bash\necho "zenity $*" >> "$HOME/zenity.log"\n' +
    'case " $* " in *" --progress "*) cat >/dev/null;; esac\nexit 0\n', { mode: 0o755 });
  return dir;
}

function kos(appDir, home, args = []) {
  return spawnSync('bash', [path.join(appDir, 'AppRun'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
}

const kurulumYolu = (home) => path.join(home, 'DijiTap', PUB, APP);
const ikiliYolu = (home) => path.join(kurulumYolu(home), APP);
const isaretYolu = (home) => path.join(kurulumYolu(home), '.empp-version');
const isaret = (home) => fs.readFileSync(isaretYolu(home), 'utf8').trim();
const yedekler = (home) => fs.readdirSync(path.join(home, 'DijiTap', PUB))
  .filter((ad) => ad.startsWith(`${APP}.yedek-`));
const zenityGunlugu = (home) => {
  const p = path.join(home, 'zenity.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};
const gunlugunuSil = (home) => fs.rmSync(path.join(home, 'zenity.log'), { force: true });

// fs-shim'in yazdığı yer (~/.empp-work[/altKitap]/…): anahtar deposu burada yaşar.
function kullaniciVerisiKur(home) {
  const dizin = path.join(home, '.empp-work', 'book1', 'classlibraries');
  fs.mkdirSync(dizin, { recursive: true });
  const p = path.join(dizin, 'ImWin32.dll');
  fs.writeFileSync(p, 'ANAHTAR-DEPOSU');
  fs.utimesSync(p, ESKI_ZAMAN, ESKI_ZAMAN);
  return p;
}

function eskiZamanaAl(p) {
  fs.utimesSync(p, ESKI_ZAMAN, ESKI_ZAMAN);
  return fs.statSync(p).mtimeMs;
}

function kurulmusOlsun(kok, home, surum, etiket) {
  const appDir = sahteAppDir(kok, surum, etiket);
  const r = kos(appDir, home);
  assert.strictEqual(r.status, 0, `ön kurulum düştü: ${r.stderr}`);
  assert.strictEqual(isaret(home), surum);
  return appDir;
}

test('şablon sözdizimi geçerli (bash -n)', () => {
  const r = spawnSync('bash', ['-n', TEMPLATE], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
});

test('temiz makine: kurar, sürüm işaretini yazar, ikiliyi argümanlarla çalıştırır',
  { skip: GERCEK_ZENITY_VAR }, () => {
    const { kok, home } = ortam();
    const appDir = sahteAppDir(kok, '1.12.9', 'v1');
    const r = kos(appDir, home, ['kitap.pdf']);
    assert.strictEqual(r.status, 0, r.stderr);
    const beklenen = `CALISTI v1 ${ikiliYolu(home)} kitap.pdf --no-sandbox`;
    assert.ok(r.stdout.includes(beklenen), r.stdout);
    assert.strictEqual(isaret(home), '1.12.9');
    assert.deepStrictEqual(yedekler(home), []);
    assert.match(zenityGunlugu(home), /--progress/);
    const kurum = path.join(kurulumYolu(home), 'resources', 'app', 'build', 'kurum.txt');
    assert.strictEqual(fs.readFileSync(kurum, 'utf8').trim(), '42');
  });

test('aynı sürüm: yeniden kurulum YOK (ikili mtime aynı, yedek yok, zenity yok), çalışır',
  { skip: GERCEK_ZENITY_VAR }, () => {
    const { kok, home } = ortam();
    const appDir = kurulmusOlsun(kok, home, '1.12.9', 'v1');
    const mtime = eskiZamanaAl(ikiliYolu(home));
    gunlugunuSil(home);
    const r = kos(appDir, home);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /CALISTI v1 /);
    assert.strictEqual(fs.statSync(ikiliYolu(home)).mtimeMs, mtime, 'ikili yeniden yazıldı');
    assert.deepStrictEqual(yedekler(home), []);
    assert.strictEqual(zenityGunlugu(home), '');
    assert.strictEqual(r.stderr.trim(), '');
  });

test('daha yeni paket (1.12.10 > 1.12.9): eskisi .yedek-*, yenisi kurulur, veri aynen',
  { skip: GERCEK_ZENITY_VAR }, () => {
    const { kok, home } = ortam();
    kurulmusOlsun(kok, home, '1.12.9', 'v1');
    const veri = kullaniciVerisiKur(home);
    const veriMtime = fs.statSync(veri).mtimeMs;
    gunlugunuSil(home);
    const yeni = sahteAppDir(kok, '1.12.10', 'v2'); // sözlük sırasında 1.12.10 < 1.12.9
    const r = kos(yeni, home);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /CALISTI v2 /);
    assert.strictEqual(isaret(home), '1.12.10');
    assert.match(fs.readFileSync(ikiliYolu(home), 'utf8'), /CALISTI v2/);
    const yedek = yedekler(home);
    assert.strictEqual(yedek.length, 1, `yedek sayısı: ${yedek}`);
    const eskiIkili = path.join(home, 'DijiTap', PUB, yedek[0], APP);
    assert.match(fs.readFileSync(eskiIkili, 'utf8'), /CALISTI v1/, 'eski kurulum kaybolmuş');
    assert.strictEqual(fs.readFileSync(veri, 'utf8'), 'ANAHTAR-DEPOSU');
    assert.strictEqual(fs.statSync(veri).mtimeMs, veriMtime, 'kullanıcı verisine dokunuldu');
    assert.match(zenityGunlugu(home), /--progress/);
  });

test('eski paket (1.12.9) / yeni kurulum (1.12.10): düşürme yok, kurulu çalışır, tek not',
  { skip: GERCEK_ZENITY_VAR }, () => {
    const { kok, home } = ortam();
    kurulmusOlsun(kok, home, '1.12.10', 'v2');
    const mtime = eskiZamanaAl(ikiliYolu(home));
    gunlugunuSil(home);
    const eski = sahteAppDir(kok, '1.12.9', 'v1');
    const r = kos(eski, home);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /CALISTI v2 /);
    assert.strictEqual(isaret(home), '1.12.10');
    assert.strictEqual(fs.statSync(ikiliYolu(home)).mtimeMs, mtime, 'kurulu ikili değişti');
    assert.deepStrictEqual(yedekler(home), []);
    assert.strictEqual(zenityGunlugu(home), '');
    const notlar = r.stderr.split('\n').filter((s) => s.trim());
    assert.strictEqual(notlar.length, 1, `stderr: ${r.stderr}`);
    assert.ok(notlar[0].includes('1.12.9') && notlar[0].includes('1.12.10'), notlar[0]);
  });

test('işaret yok (eski sistem kurulumu): aynı sürüm bile olsa yeniden kurar',
  { skip: GERCEK_ZENITY_VAR }, () => {
    const { kok, home } = ortam();
    const appDir = kurulmusOlsun(kok, home, '1.12.9', 'v1');
    fs.rmSync(isaretYolu(home));
    const r = kos(appDir, home);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /CALISTI v1 /);
    assert.strictEqual(isaret(home), '1.12.9');
    assert.strictEqual(yedekler(home).length, 1);
  });

test('güncelleme kurulumu başarısız olursa eski kurulum geri gelir (silme yok)',
  { skip: GERCEK_ZENITY_VAR }, () => {
    const { kok, home } = ortam();
    kurulmusOlsun(kok, home, '1.12.9', 'v1');
    const bozuk = sahteAppDir(kok, '1.12.11', 'v3');
    fs.rmSync(path.join(bozuk, APP));
    fs.rmSync(path.join(bozuk, `${APP}.desktop`));
    const r = kos(bozuk, home);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.match(fs.readFileSync(ikiliYolu(home), 'utf8'), /CALISTI v1/, 'eski kurulum yok');
    assert.strictEqual(isaret(home), '1.12.9');
    assert.deepStrictEqual(yedekler(home), []);
    const basarisiz = fs.readdirSync(path.join(home, 'DijiTap', PUB))
      .filter((ad) => ad.startsWith(`${APP}.basarisiz-`));
    assert.strictEqual(basarisiz.length, 1);
    assert.match(zenityGunlugu(home), /--error/);
  });

test('APP_VERSION boş: eski davranış (kuruluysa dokunmadan çalıştırır, işaret yazmaz)',
  { skip: GERCEK_ZENITY_VAR }, () => {
    const { kok, home } = ortam();
    const appDir = sahteAppDir(kok, '', 'v0');
    assert.strictEqual(kos(appDir, home).status, 0);
    assert.ok(!fs.existsSync(isaretYolu(home)));
    const mtime = eskiZamanaAl(ikiliYolu(home));
    const r = kos(appDir, home);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /CALISTI v0 /);
    assert.strictEqual(fs.statSync(ikiliYolu(home)).mtimeMs, mtime);
    assert.deepStrictEqual(yedekler(home), []);
  });
