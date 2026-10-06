'use strict';
// disk-temizlik.sh — sahte geçici $HOME (dt-ev-*) altında GERÇEKTEN koşar. Test anahtarları
// (DT_DF, DT_KULLANIMDA, DT_PROC_YOK) yalnız test kilidiyle okunur: $HOME/.dt-test-kilidi.
// Nadir 06.10: disk dolu → işi durdurma, yer aç; koruma listesi ASLA silinmez.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const BETIK = path.join(__dirname, 'disk-temizlik.sh');
const GUN = 86400;
const TMP = fs.realpathSync(os.tmpdir());
const LINUX = process.platform === 'linux';
const kokler = [];
test.after(() => {
  for (const h of kokler) {
    spawnSync('chmod', ['-R', 'u+rwx', h]);
    fs.rmSync(h, { recursive: true, force: true });
  }
});

function sahteEv({ izin = true, serit = true } = {}) {
  const h = fs.mkdtempSync(path.join(TMP, 'dt-ev-'));
  kokler.push(h);
  fs.writeFileSync(path.join(h, '.dt-test-kilidi'), 'test\n');
  if (serit) fs.mkdirSync(path.join(h, 'empp-serit', 'log'), { recursive: true });
  if (serit && izin) fs.writeFileSync(path.join(h, 'empp-serit', 'disk-temizlik.izin'), 'test\n');
  return h;
}
function disariDizin() {
  const d = fs.mkdtempSync(path.join(TMP, 'dt-disari-'));
  kokler.push(d);
  return d;
}
function yaslandir(p, gun) {
  const t = Date.now() / 1000 - gun * GUN;
  const st = fs.lstatSync(p);
  if (st.isDirectory() && !st.isSymbolicLink()) for (const a of fs.readdirSync(p)) yaslandir(path.join(p, a), gun);
  if (!st.isSymbolicLink()) fs.utimesSync(p, t, t);
}
/** `rel` dosyasını `kb` boyutunda yazar; `aday` (yoksa dosya) `gun` gün yaşlandırılır. */
function dosya(h, rel, { kb = 4, gun = 10, aday = null } = {}) {
  const p = path.join(h, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(kb * 1024, 1));
  yaslandir(aday ? path.join(h, aday) : p, gun);
  return p;
}
function kostur(h, arg = [], env = {}, { kilit = true } = {}) {
  const r = spawnSync('bash', [BETIK, ...arg], {
    encoding: 'utf8',
    env: {
      ...process.env, HOME: h, TMPDIR: TMP, DT_DF: '100000000 0', DT_PROC_YOK: '1',
      ...(kilit ? { DT_TEST_KILIDI: path.join(h, '.dt-test-kilidi') } : { DT_TEST_KILIDI: '' }),
      ...env,
    },
  });
  const lg = path.join(h, 'empp-serit/log/disk-temizlik.log');
  r.log = fs.existsSync(lg) ? fs.readFileSync(lg, 'utf8') : '';
  return r;
}
const var_ = (h, rel) => fs.existsSync(path.join(h, rel)) || (() => { try { fs.lstatSync(path.join(h, rel)); return true; } catch (_) { return false; } })();
const ULASILMAZ = ['--hedef-gb', '0', '--hedef-yuzde', '1']; // 100 GB × %1 = 1 GB: küçük dosyalarla ulaşılmaz

test('bash sözdizimi geçerli', () => {
  const r = spawnSync('bash', ['-n', BETIK], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

// ---------------------------------------------------------------- korkuluklar
test('Mac korkuluğu: test kilidi yoksa Darwin\'de DT_DF verilse de KOŞMAZ (çıkış 2, silme yok)', { skip: process.platform !== 'darwin' }, () => {
  const h = sahteEv();
  dosya(h, 'testler/a.bin');
  const r = kostur(h, ['--ek', path.join(h, 'testler')], {}, { kilit: false });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.ok(var_(h, 'testler/a.bin'));
});

test('test kilidi sahte değilse anahtarlar yok sayılır: HOME adı dt-ev-* değil → kilit geçersiz', { skip: process.platform !== 'darwin' }, () => {
  const h = fs.mkdtempSync(path.join(TMP, 'baska-'));
  kokler.push(h);
  fs.writeFileSync(path.join(h, '.dt-test-kilidi'), 'x');
  fs.mkdirSync(path.join(h, 'empp-serit/log'), { recursive: true });
  fs.writeFileSync(path.join(h, 'empp-serit/disk-temizlik.izin'), 'x');
  dosya(h, 'testler/a.bin');
  const r = kostur(h, ['--ek', path.join(h, 'testler')]);
  assert.equal(r.status, 2);
  assert.ok(var_(h, 'testler/a.bin'));
});

test('test anahtarları kilitsiz yok sayılır (Linux): DT_DF tohumu ölçüme girmez', { skip: !LINUX }, () => {
  const h = sahteEv();
  const r = kostur(h, ['--kuru'], { DT_DF: '100 0' }, { kilit: false });
  assert.doesNotMatch(r.stdout, /toplam 1 MB/);
});

test('srv21 değişmezi: DT_DF\'siz + ~/empp-serit yok → çıkış 2', () => {
  const h = sahteEv({ serit: false });
  dosya(h, 'testler/a.bin');
  const r = kostur(h, ['--ek', path.join(h, 'testler')], { DT_DF: '' });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /ProBook seridi degil/);
  assert.ok(var_(h, 'testler/a.bin'));
});

test('srv21 değişmezi: izin dosyası yok → çıkış 2', () => {
  const h = sahteEv({ izin: false });
  dosya(h, 'testler/a.bin');
  const r = kostur(h, ['--ek', path.join(h, 'testler')]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /izinsiz makinede KOSMAZ/);
  assert.ok(var_(h, 'testler/a.bin'));
});

// ---------------------------------------------------------------- sıra ve hedef
test('KURU: hiçbir şey silinmez; sıra K1 → K2; K3 sert eşik ÜSTÜNDE açılmaz', () => {
  const h = sahteEv();
  dosya(h, '.empp-agent/kaynak-arsivi/111/build.zip', { gun: 30, aday: '.empp-agent/kaynak-arsivi/111' });
  dosya(h, '.empp-agent/icerik-onbellek/222/222-1.zip', { gun: 20, aday: '.empp-agent/icerik-onbellek/222' });
  dosya(h, 'testler/deneme/x.bin', { gun: 5, aday: 'testler/deneme' });
  dosya(h, 'Silinecekler/eski.impark', { gun: 8 });
  // boş 20 GB > sert 15 GB; hedef 50 GB → K1+K2 aday, K3 değil.
  const r = kostur(h, ['--kuru'], { DT_DF: '200000000 20971520' });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  const sira = r.stdout.split('\n').filter((s) => s.startsWith('KURU ')).map((s) => s.match(/^KURU \d+ MB (\/.*?) \(/)[1].slice(h.length + 1));
  assert.deepEqual(sira, ['Silinecekler/eski.impark', 'testler/deneme', '.empp-agent/icerik-onbellek/222']);
  assert.ok(var_(h, 'testler/deneme/x.bin'));
  assert.match(r.log, / · KURU: test\/deneme \(testler\)/);
});

test('K3: sert eşik ALTINDA açılır, sert eşiğe ulaşınca durur', () => {
  const h = sahteEv();
  dosya(h, '.empp-agent/kaynak-arsivi/1/build.zip', { kb: 600, gun: 30, aday: '.empp-agent/kaynak-arsivi/1' });
  dosya(h, '.empp-agent/kaynak-arsivi/2/build.zip', { kb: 600, gun: 20, aday: '.empp-agent/kaynak-arsivi/2' });
  // sert eşik 1 GB = 1048576 KB; boş 1048000 KB + 600 KB ≥ 1048576 → ilk arşiv yeter.
  const r = kostur(h, ['--sert-gb', '1', '--hedef-gb', '50'], { DT_DF: '200000000 1048000' });
  assert.equal(r.status, 3, r.stdout);
  assert.ok(!var_(h, '.empp-agent/kaynak-arsivi/1'), r.stdout);
  assert.ok(var_(h, '.empp-agent/kaynak-arsivi/2'), 'sert eşiğe ulaşınca durmalı');
});

test('GERÇEK: en eskiden başlar, hedefe ulaşınca DURUR; günlükte tarih · yol · boyut · neden', () => {
  const h = sahteEv();
  dosya(h, 'testler/c-en-eski.bin', { kb: 600, gun: 30 });
  dosya(h, 'testler/b-orta.bin', { kb: 600, gun: 20 });
  dosya(h, 'testler/a-en-yeni.bin', { kb: 600, gun: 10 });
  const r = kostur(h, ['--hedef-gb', '0', '--hedef-yuzde', '1'], { DT_DF: '100000 0' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!var_(h, 'testler/c-en-eski.bin'));
  assert.ok(!var_(h, 'testler/b-orta.bin'));
  assert.ok(var_(h, 'testler/a-en-yeni.bin'), 'hedefe ulaşınca durmalı');
  assert.match(r.log, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d · \/.*testler\/c-en-eski\.bin · \d+ MB · test\/deneme \(testler\)$/m);
});

test('--hedef-gb varsayılan rahatlık hedefinin YERİNE geçer (yüzde 0 ile yalnız gereken GB)', () => {
  const h = sahteEv();
  dosya(h, 'testler/a.bin', { gun: 9 });
  // boş 2 GB, --hedef-gb 1 → hedef sağlanmış, aday taranmaz.
  const r = kostur(h, ['--hedef-gb', '1', '--hedef-yuzde', '0'], { DT_DF: '200000000 2097152' });
  assert.equal(r.status, 0, r.stdout);
  assert.ok(var_(h, 'testler/a.bin'));
});

// ---------------------------------------------------------------- koruma tablosu
test('KORUMA TABLOSU: korunan her yol düz, //, .. ve sembolik bağlı üst biçimiyle --ek verilse de SİLİNMEZ', () => {
  const h = sahteEv();
  const korunan = [
    '.empp-agent/token.json', '.empp-agent/kabuk/k.js', '.empp-agent/motor/m.js', '.empp-agent/yuklemeler/y.json',
    '.empp-agent/windows-hazir/1-2.0.0/manifest.json', '.empp-agent/kaynak-yok-bildirim.json',
    '.empp-agent/imza-oncelik.txt', '.empp-agent/aktivasyon-test-kodu.txt', 'empp-serit/repo/package.json',
    'empp-serit/node/bin/node', 'empp-serit/opt/bin/unrar', 'empp-serit/logolar/l.png', 'empp-serit/log/agent.log',
    'empp-serit/cache/c.bin', 'empp-serit/araclar/disk-temizlik.sh', 'empp-serit/disk-temizlik.izin',
    '.ssh/id', '.config/c', '.local/l', 'Belgeler/b.odt', 'Documents/d', 'Masaüstü/m', 'Desktop/d', 'Resimler/r', 'Pictures/p',
  ];
  for (const rel of korunan) if (!fs.existsSync(path.join(h, rel))) dosya(h, rel, { gun: 90 });
  fs.symlinkSync(path.join(h, '.empp-agent'), path.join(h, 'kisayol'));
  const ekler = [];
  for (const rel of korunan) {
    ekler.push(path.join(h, rel));                                      // düz
    ekler.push(`${h}//${rel.replace('/', '//')}`);                      // //
    ekler.push(path.join(h, 'testler') + '/../' + rel);                 // ..
    ekler.push(path.dirname(path.join(h, rel)));                        // üst dizin (ata)
  }
  for (const a of ['token.json', 'kabuk', 'windows-hazir', 'imza-oncelik.txt']) ekler.push(path.join(h, 'kisayol', a)); // sembolik bağlı üst
  for (const k of [h, path.join(h, '.empp-agent'), path.join(h, 'empp-serit'), path.join(h, 'kisayol')]) ekler.push(k, `${k}/`);
  fs.mkdirSync(path.join(h, 'testler'), { recursive: true });
  const r = kostur(h, ekler.flatMap((e) => ['--ek', e]).concat(ULASILMAZ));
  for (const rel of korunan) assert.ok(fs.existsSync(path.join(h, rel)), `korunan silindi: ${rel}\n${r.stdout}`);
  // kisayol bağının KENDİSİ silinebilir (yalnız bağ); gösterdiği korunan kök yukarıda doğrulandı.
  assert.doesNotMatch(r.stdout, /^SILINDI .*(token|kabuk|windows-hazir|repo|\.ssh)/m);
});

test('KORUMA: gerçek yolu HOME dışında olan --ek atlanır; dışarıyı gösteren bağ yalnız bağ olarak silinir', () => {
  const h = sahteEv();
  const d = disariDizin();
  fs.writeFileSync(path.join(d, 'dis.bin'), 'x');
  fs.symlinkSync(d, path.join(h, 'disari'));
  const r = kostur(h, ['--ek', path.join(h, 'disari', 'dis.bin'), '--ek', '/etc', '--ek', path.join(h, 'disari'), ...ULASILMAZ]);
  assert.ok(fs.existsSync(path.join(d, 'dis.bin')), 'dışarıdaki dosya silinmemeli');
  assert.match(r.stdout, /ATLANDI .*disari\/dis\.bin \(gercek yol HOME disinda/);
  assert.match(r.stdout, /ATLANDI \/etc \(gercek yol HOME disinda/);
  assert.ok(!var_(h, 'disari'), 'bağın kendisi silinebilir');
  assert.ok(fs.existsSync(d), 'bağın hedefi korunur');
});

test('KORUMA: --koru verilen yol (çalışan işin arşivi) sert eşik altında da SİLİNMEZ', () => {
  const h = sahteEv();
  dosya(h, '.empp-agent/kaynak-arsivi/9/build.zip', { kb: 600, gun: 90, aday: '.empp-agent/kaynak-arsivi/9' });
  dosya(h, '.empp-agent/kaynak-arsivi/8/build.zip', { kb: 600, gun: 30, aday: '.empp-agent/kaynak-arsivi/8' });
  const r = kostur(h, ['--koru', path.join(h, '.empp-agent/kaynak-arsivi/9'), '--hedef-gb', '50', '--sert-gb', '50']);
  assert.ok(var_(h, '.empp-agent/kaynak-arsivi/9/build.zip'), r.stdout);
  assert.ok(!var_(h, '.empp-agent/kaynak-arsivi/8'), 'korunmayan arşiv sert eşik altında silinir');
  assert.match(r.stdout, /ATLANDI .*kaynak-arsivi\/9 \(koruma: /);
});

test('KORUMA: çalışan işin dizini (süreç cwd/açık dosya) atlanır — --ek dahil', () => {
  const h = sahteEv();
  dosya(h, 'empp-serit/kabul-ev/ev-1/a.bin', { aday: 'empp-serit/kabul-ev/ev-1' });
  dosya(h, 'DijiTap/DijiTap/Kitap/app.bin', { aday: 'DijiTap' });
  const kullanim = path.join(h, 'kullanim.txt');
  fs.writeFileSync(kullanim, `${path.join(h, 'empp-serit/kabul-ev/ev-1/a.bin')}\n${path.join(h, 'DijiTap/DijiTap/Kitap/app.bin')}\n`);
  const r = kostur(h, ['--ek', path.join(h, 'DijiTap'), ...ULASILMAZ], { DT_KULLANIMDA: kullanim });
  assert.ok(var_(h, 'empp-serit/kabul-ev/ev-1/a.bin'));
  assert.ok(var_(h, 'DijiTap/DijiTap/Kitap/app.bin'), 'açık uygulama varken DijiTap silinmez');
  assert.match(r.stdout, /ATLANDI .*DijiTap \(kullanimda/);
});

test('FAIL-CLOSED: süreç taraması yapılamıyorsa (Mac\'te /proc yok) her aday kullanımda sayılır', { skip: LINUX }, () => {
  const h = sahteEv();
  dosya(h, 'testler/a.bin', { gun: 9 });
  const r = kostur(h, ['--ek', path.join(h, 'testler'), ...ULASILMAZ], { DT_PROC_YOK: '' });
  assert.ok(var_(h, 'testler/a.bin'), r.stdout);
  assert.match(r.stdout, /ATLANDI .*testler \(kullanimda/);
  assert.match(r.log, /surec taramasi eksik/);
});

test('GERÇEK SÜREÇ (Linux): cwd\'si adayda olan sleep süreci varken aday SİLİNMEZ', { skip: !LINUX }, async () => {
  const h = sahteEv();
  dosya(h, 'testler/calisan/a.bin', { gun: 9, aday: 'testler/calisan' });
  const s = spawn('sleep', ['30'], { cwd: path.join(h, 'testler/calisan'), stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 300));
    const r = kostur(h, ['--ek', path.join(h, 'testler/calisan'), ...ULASILMAZ], { DT_PROC_YOK: '' });
    assert.ok(var_(h, 'testler/calisan/a.bin'), r.stdout);
    assert.match(r.stdout, /ATLANDI .*testler\/calisan \(kullanimda/);
  } finally { s.kill(); }
  await new Promise((r) => setTimeout(r, 200));
  const r2 = kostur(h, ['--ek', path.join(h, 'testler/calisan'), ...ULASILMAZ], { DT_PROC_YOK: '' });
  assert.ok(!var_(h, 'testler/calisan'), `süreç bitince silinmeli: ${r2.stdout}`);
});

test('KORUMA: sahibi canlı runner iş dizini (.empp-sahip.pid) atlanır; sahibi ölü olan silinir', () => {
  const h = sahteEv();
  dosya(h, 'empp-serit/work/empp-agent-CANLI/build.zip', { gun: 9, aday: 'empp-serit/work/empp-agent-CANLI' });
  fs.writeFileSync(path.join(h, 'empp-serit/work/empp-agent-CANLI/.empp-sahip.pid'), String(process.pid));
  yaslandir(path.join(h, 'empp-serit/work/empp-agent-CANLI'), 9);
  dosya(h, 'empp-serit/work/empp-agent-OLU/build.zip', { gun: 9, aday: 'empp-serit/work/empp-agent-OLU' });
  fs.writeFileSync(path.join(h, 'empp-serit/work/empp-agent-OLU/.empp-sahip.pid'), '999999');
  yaslandir(path.join(h, 'empp-serit/work/empp-agent-OLU'), 9);
  const r = kostur(h, ULASILMAZ);
  assert.ok(var_(h, 'empp-serit/work/empp-agent-CANLI/build.zip'), r.stdout);
  assert.match(r.stdout, /empp-agent-CANLI \(sahibi canli/);
  assert.ok(!var_(h, 'empp-serit/work/empp-agent-OLU'), r.stdout);
});

test('İLK TEMİZLİK: --ek ~/testler ~/Silinecekler ~/DijiTap bütünüyle silinir', () => {
  const h = sahteEv();
  dosya(h, 'testler/_silinecek/a.bin', { gun: 0, aday: 'testler' });
  dosya(h, 'Silinecekler/.45482.part', { aday: 'Silinecekler' });
  dosya(h, 'DijiTap/DijiTap/Cambridge/app.bin', { aday: 'DijiTap' });
  const r = kostur(h, ['--ek', '~/testler', '--ek', path.join(h, 'Silinecekler/'), '--ek', path.join(h, 'DijiTap')],
    { DT_DF: '100000000 99000000' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const rel of ['testler', 'Silinecekler', 'DijiTap']) assert.ok(!var_(h, rel), `${rel} kaldı: ${r.stdout}`);
  assert.equal((r.log.match(/kullanici acikca verdi \(--ek\)/g) || []).length, 3);
});

test('KORUMA: son 120 dk içinde değişen ağaç atlanır; --ek yenilik kuralını aşar', () => {
  const h = sahteEv();
  dosya(h, 'testler/taze/yeni.bin', { gun: 0, aday: 'testler/taze' });
  dosya(h, 'kabuk-aday-test/x.bin', { gun: 0, aday: 'kabuk-aday-test' });
  const r = kostur(h, ['--ek', '~/kabuk-aday-test', ...ULASILMAZ]);
  assert.ok(var_(h, 'testler/taze/yeni.bin'));
  assert.match(r.stdout, /ATLANDI .*testler\/taze \(son 120 dk/);
  assert.ok(!var_(h, 'kabuk-aday-test'));
});

test('KORUMA: kabul kanıtı son 7 gün SİLİNMEZ; daha eskisi K2 adayıdır', () => {
  const h = sahteEv();
  dosya(h, '.empp-agent/kabul-kanit/yeni-3gun/k.json', { gun: 3, aday: '.empp-agent/kabul-kanit/yeni-3gun' });
  dosya(h, '.empp-agent/kabul-kanit/eski-9gun/k.json', { gun: 9, aday: '.empp-agent/kabul-kanit/eski-9gun' });
  const r = kostur(h, ULASILMAZ);
  assert.ok(var_(h, '.empp-agent/kabul-kanit/yeni-3gun/k.json'));
  assert.ok(!var_(h, '.empp-agent/kabul-kanit/eski-9gun'), r.stdout);
});

test('kabuk-aday ve İndirilenler paketleri aday; belge aday DEĞİL; sekme/yeni satırlı ad doğru işlenir', () => {
  const h = sahteEv();
  dosya(h, 'kabuk-aday-test/1.13.14/a.bin', { aday: 'kabuk-aday-test' });
  dosya(h, 'İndirilenler/Cambridge One.yds', { gun: 3 });
  dosya(h, 'İndirilenler/fatura.pdf', { gun: 300 });
  dosya(h, 'testler/garip\tad\nsatir.bin', { gun: 4 });
  const r = kostur(h, ULASILMAZ);
  assert.ok(!var_(h, 'kabuk-aday-test'), r.stdout);
  assert.ok(!var_(h, 'İndirilenler/Cambridge One.yds'));
  assert.ok(var_(h, 'İndirilenler/fatura.pdf'));
  assert.ok(!var_(h, 'testler/garip\tad\nsatir.bin'), r.stdout);
});

test('kaynak arşivi SON ÇARE: K1 hedefi karşılıyorsa arşive dokunulmaz', () => {
  const h = sahteEv();
  dosya(h, '.empp-agent/kaynak-arsivi/9/build.zip', { kb: 600, gun: 90, aday: '.empp-agent/kaynak-arsivi/9' });
  dosya(h, 'testler/t.bin', { kb: 1200, gun: 1 });
  const r = kostur(h, ['--hedef-gb', '0', '--hedef-yuzde', '1', '--sert-gb', '50'], { DT_DF: '100000 0' });
  assert.equal(r.status, 0, r.stdout);
  assert.ok(var_(h, '.empp-agent/kaynak-arsivi/9/build.zip'));
  assert.ok(!var_(h, 'testler/t.bin'));
});

// ---------------------------------------------------------------- disk tam dolu
test('DİSK DOLU: günlük yazılamazsa satır stdout\'a düşer, silme sürer', () => {
  const h = sahteEv();
  dosya(h, 'testler/a.bin', { gun: 9 });
  const lg = path.join(h, 'empp-serit/log/disk-temizlik.log');
  fs.writeFileSync(lg, '');
  fs.chmodSync(lg, 0o444);
  const r = kostur(h, ULASILMAZ);
  assert.ok(!var_(h, 'testler/a.bin'), r.stdout + r.stderr);
  assert.match(r.stdout, /^GUNLUK-YAZILAMADI .*testler\/a\.bin/m);
});

test('kilit: canlı bir koşu varken ikinci koşu 4 ile çıkar (Linux flock, Mac mkdir yedeği)', async () => {
  const h = sahteEv();
  const flockVar = spawnSync('sh', ['-c', 'command -v flock']).status === 0;
  if (flockVar) {
    const s = spawn('flock', [path.join(h, 'empp-serit'), 'sleep', '5'], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 300));
    try { assert.equal(kostur(h, ULASILMAZ).status, 4); } finally { s.kill(); }
  } else {
    const k = path.join(h, 'empp-serit/log/.disk-temizlik.kilit.d');
    fs.mkdirSync(k, { recursive: true });
    fs.writeFileSync(path.join(k, 'pid'), String(process.pid));
    assert.equal(kostur(h, ULASILMAZ).status, 4);
  }
});

test('kur.sh disk kapısı önce temizliği koşturur, sonra yeniden ölçer; zamanlayıcı kurulumu izin dosyası yazar', () => {
  const KUR = fs.readFileSync(path.join(__dirname, 'kur.sh'), 'utf8');
  const g = KUR.slice(KUR.indexOf('probook_kur(){'), KUR.indexOf('# Node 22 x64'));
  const iTemiz = g.indexOf('bash "$DT"');
  const iDur = g.indexOf('die "disk kapisi: ${BOS} GB bos < 30 GB"');
  assert.ok(iTemiz > 0 && iTemiz < iDur, 'temizlik dur kararından ÖNCE');
  assert.ok(g.lastIndexOf('BOS=$(df', iDur) > iTemiz, 'temizlikten sonra yeniden ölçülür');
  assert.match(KUR, /disk-temizlik\.sh" --zamanlayici-kur/);
  const B = fs.readFileSync(BETIK, 'utf8');
  assert.match(B, /> "\$IZIN"/);
  assert.match(B, /\[ "\$D" = active \] && exit 0 \|\| exit 1/);
  assert.doesNotMatch(B.split('\n').filter((s) => !s.trim().startsWith('#')).join('\n'), /sudo -n rm/);
  const ORTAM = fs.readFileSync(path.join(__dirname, 'serit-ortam.sh'), 'utf8');
  assert.match(ORTAM, /export EMPP_DISK_TEMIZLIK="\$\{EMPP_DISK_TEMIZLIK:-1\}"/);
});

// ---------------------------------------------------------------- 2. inceleme (K1, K3, K5, Ö-B)
test('K5 srv21 negatif işareti: /opt/empp-packager (testte DT_SRV21_ISARET) varsa ana akış da kurulum da çıkış 2', () => {
  const h = sahteEv();
  dosya(h, 'testler/a.bin', { gun: 9 });
  const isaret = path.join(h, 'opt-empp-packager');
  fs.mkdirSync(isaret);
  const r = kostur(h, ['--ek', path.join(h, 'testler')], { DT_SRV21_ISARET: isaret });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /srv21, KOSMAZ/);
  assert.ok(var_(h, 'testler/a.bin'));
  fs.rmSync(path.join(h, 'empp-serit/disk-temizlik.izin'));
  const z = kostur(h, ['--zamanlayici-kur'], { DT_SRV21_ISARET: isaret });
  assert.equal(z.status, 2);
  assert.ok(!var_(h, 'empp-serit/disk-temizlik.izin'), 'srv21\'de izin dosyası YAZILMAZ');
});

test('K1 test kipinde /tmp yerine $HOME/tmp: kabul-*.impark kopyası oradan silinir', () => {
  const h = sahteEv();
  fs.mkdirSync(path.join(h, 'tmp'), { recursive: true });
  dosya(h, 'tmp/kabul-1.impark', { gun: 2 });
  const r = kostur(h, ULASILMAZ);
  assert.ok(!var_(h, 'tmp/kabul-1.impark'), r.stdout);
  assert.match(r.stdout, /SILINDI .*\/tmp\/kabul-1\.impark \(kabul kopyasi/);
});

test('K3: boş .empp-sahip.pid "yok" sayılır — dizin silinir', () => {
  const h = sahteEv();
  const d = 'empp-serit/work/empp-agent-BOS';
  dosya(h, `${d}/build.zip`, { gun: 9 });
  fs.writeFileSync(path.join(h, d, '.empp-sahip.pid'), '');
  yaslandir(path.join(h, d), 9);
  const r = kostur(h, ULASILMAZ);
  assert.ok(!var_(h, d), r.stdout);
});

test('Ö-B: SONUC satırı tarama alanı taşır (test anahtarıyla tamam)', () => {
  const h = sahteEv();
  const r = kostur(h, ['--kuru']);
  assert.match(r.stdout, /^SONUC .* tarama=tamam$/m);
});

test('Ö-B (Mac): süreç taraması yoksa SONUC tarama=bozuk', { skip: LINUX }, () => {
  const h = sahteEv();
  dosya(h, 'testler/a.bin', { gun: 9 });
  const r = kostur(h, ULASILMAZ, { DT_PROC_YOK: '' });
  assert.match(r.stdout, /^SONUC .* tarama=bozuk$/m);
  assert.ok(var_(h, 'testler/a.bin'));
});

test('Ö-B (Linux): sudo -n bash yoksa sudosuz taramaya düşer; okunamayan süreç → fail-closed, tarama=bozuk, günlükte neden', { skip: !LINUX }, () => {
  const h = sahteEv();
  dosya(h, 'testler/a.bin', { gun: 9 });
  const bin = path.join(h, 'sahte-bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'sudo'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const r = kostur(h, ULASILMAZ, { DT_PROC_YOK: '', PATH: `${bin}:${process.env.PATH}` });
  assert.match(r.stdout, /^SONUC .* tarama=bozuk$/m, r.stdout);
  assert.ok(var_(h, 'testler/a.bin'), 'tarama bozukken hiçbir şey silinmez');
  assert.match(r.log, /surec taramasi eksik \(sudo -n bash yok\)/);
});

test('kur.sh sudo -n bash sonucunu raporlar', () => {
  const KUR = fs.readFileSync(path.join(__dirname, 'kur.sh'), 'utf8');
  assert.match(KUR, /if sudo -n bash -c true 2>\/dev\/null; then log "sudo -n bash: VAR/);
  assert.match(KUR, /UYARI: sudo -n bash YOK/);
});
