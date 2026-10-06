'use strict';
// disk-temizlik.sh — sahte $HOME altında GERÇEKTEN koşar (DT_DF ile disk ölçümü tohumlanır,
// DT_PROC_YOK ile gerçek süreç taraması kapalı, DT_KULLANIMDA ile "çalışan iş" taklit edilir).
// Nadir 06.10: disk dolu → işi durdurma, yer aç; ama koruma listesi ASLA silinmez.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BETIK = path.join(__dirname, 'disk-temizlik.sh');
const GUN = 86400;
const evler = [];
test.after(() => { for (const h of evler) fs.rmSync(h, { recursive: true, force: true }); });

function sahteEv() {
  const h = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dt-ev-')));
  evler.push(h);
  fs.mkdirSync(path.join(h, 'tmp'));
  return h;
}
/** Ağacı (kendisi + altı) `gun` gün yaşlandırır. */
function yaslandir(p, gun) {
  const t = Date.now() / 1000 - gun * GUN;
  const st = fs.lstatSync(p);
  if (st.isDirectory()) for (const a of fs.readdirSync(p)) yaslandir(path.join(p, a), gun);
  fs.utimesSync(p, t, t);
}
/** `rel` dosyasını `kb` boyutunda yazar; en üst aday dizini (`aday`) `gun` gün yaşlandırır. */
function dosya(h, rel, { kb = 4, gun = 10, aday = null } = {}) {
  const p = path.join(h, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(kb * 1024, 1));
  yaslandir(aday ? path.join(h, aday) : p, gun);
  return p;
}
function kostur(h, arg = [], env = {}) {
  const r = spawnSync('bash', [BETIK, ...arg], {
    encoding: 'utf8',
    env: { ...process.env, HOME: h, TMPDIR: path.join(h, 'tmp'), DT_DF: '100000000 0', DT_PROC_YOK: '1', ...env },
  });
  r.log = fs.existsSync(path.join(h, 'empp-serit/log/disk-temizlik.log'))
    ? fs.readFileSync(path.join(h, 'empp-serit/log/disk-temizlik.log'), 'utf8') : '';
  return r;
}
const var_ = (h, rel) => fs.existsSync(path.join(h, rel));
const ULASILMAZ = ['--hedef-gb', '0', '--hedef-yuzde', '1']; // 100 GB × %1 = 1 GB: küçük dosyalarla ulaşılmaz

test('bash sözdizimi geçerli', () => {
  const r = spawnSync('bash', ['-n', BETIK], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('Mac korkuluğu: tohum (DT_DF) yoksa Darwin\'de KOŞMAZ', { skip: process.platform !== 'darwin' }, () => {
  const h = sahteEv();
  dosya(h, 'testler/a.bin');
  const r = spawnSync('bash', [BETIK], { encoding: 'utf8', env: { ...process.env, HOME: h } });
  assert.equal(r.status, 2);
  assert.ok(var_(h, 'testler/a.bin'));
});

test('KURU: hiçbir şey silinmez; sıra K1 (test) → K2 (önbellek) → K3 (kaynak arşivi); günlüğe KURU yazılır', () => {
  const h = sahteEv();
  dosya(h, '.empp-agent/kaynak-arsivi/111/build.zip', { gun: 30, aday: '.empp-agent/kaynak-arsivi/111' });
  dosya(h, '.empp-agent/icerik-onbellek/222/222-1.zip', { gun: 20, aday: '.empp-agent/icerik-onbellek/222' });
  dosya(h, 'testler/deneme/x.bin', { gun: 5, aday: 'testler/deneme' });
  dosya(h, 'Silinecekler/eski.impark', { gun: 8 });
  const r = kostur(h, ['--kuru', ...ULASILMAZ]);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  const kuru = r.stdout.split('\n').filter((s) => s.startsWith('KURU '));
  const sira = kuru.map((s) => s.match(/ (\/\S+) \(/)[1].slice(h.length + 1));
  assert.deepEqual(sira, ['Silinecekler/eski.impark', 'testler/deneme', '.empp-agent/icerik-onbellek/222', '.empp-agent/kaynak-arsivi/111'],
    'K1 içinde en eski önce (8 gün > 5 gün), K3 en sonda');
  for (const rel of ['testler/deneme/x.bin', 'Silinecekler/eski.impark', '.empp-agent/kaynak-arsivi/111/build.zip']) {
    assert.ok(var_(h, rel), `kuru koşu sildi: ${rel}`);
  }
  assert.match(r.log, / · KURU: test\/deneme \(testler\)/);
  assert.match(r.stdout, /^SONUC .*hedef=dar$/m);
});

test('GERÇEK: en eskiden başlar, hedefe ulaşınca DURUR; günlükte tarih · yol · boyut · neden', () => {
  const h = sahteEv();
  dosya(h, 'testler/c-en-eski.bin', { kb: 600, gun: 30 });
  dosya(h, 'testler/b-orta.bin', { kb: 600, gun: 20 });
  dosya(h, 'testler/a-en-yeni.bin', { kb: 600, gun: 10 });
  // toplam 100000 KB, hedef %1 = 1000 KB; iki dosya (≈1200 KB) yeter.
  const r = kostur(h, ['--hedef-gb', '0', '--hedef-yuzde', '1'], { DT_DF: '100000 0' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!var_(h, 'testler/c-en-eski.bin'));
  assert.ok(!var_(h, 'testler/b-orta.bin'));
  assert.ok(var_(h, 'testler/a-en-yeni.bin'), 'hedefe ulaşınca durmalı');
  assert.match(r.log, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d · \/.*testler\/c-en-eski\.bin · \d+ MB · test\/deneme \(testler\)$/m);
  assert.match(r.stdout, /^SONUC .*kalem=2 .*hedef=tamam$/m);
});

test('KORUMA: jeton, yapılandırma, repo, windows-hazir --ek ile bile SİLİNMEZ; HOME dışı reddedilir', () => {
  const h = sahteEv();
  dosya(h, '.empp-agent/token.json');
  dosya(h, '.empp-agent/windows-hazir/1-2.0.0/manifest.json', { aday: '.empp-agent/windows-hazir' });
  dosya(h, 'empp-serit/repo/package.json', { aday: 'empp-serit/repo' });
  dosya(h, 'empp-serit/log/agent.log');
  const r = kostur(h, ['--ek', path.join(h, '.empp-agent/token.json'), '--ek', path.join(h, '.empp-agent'),
    '--ek', path.join(h, 'empp-serit/repo'), '--ek', path.join(h, '.empp-agent/windows-hazir/1-2.0.0'),
    '--ek', h, '--ek', '/etc', ...ULASILMAZ]);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  for (const rel of ['.empp-agent/token.json', '.empp-agent/windows-hazir/1-2.0.0/manifest.json',
    'empp-serit/repo/package.json', 'empp-serit/log/agent.log']) {
    assert.ok(var_(h, rel), `korunan silindi: ${rel}`);
  }
  assert.match(r.stdout, /ATLANDI .*token\.json \(koruma: /);
  assert.match(r.stdout, /ATLANDI .*\.empp-agent \(koruma \(alti\): /);
  assert.match(r.stdout, /ATLANDI \/etc \(HOME disinda\)/);
  assert.doesNotMatch(r.stdout, /^SILINDI/m);
});

test('KORUMA: çalışan işin dizini (süreç cwd/açık dosya) atlanır — --ek dahil', () => {
  const h = sahteEv();
  dosya(h, 'empp-serit/kabul-ev/ev-1/a.bin', { aday: 'empp-serit/kabul-ev/ev-1' });
  dosya(h, 'DijiTap/DijiTap/Kitap/app.bin', { aday: 'DijiTap' });
  const kullanim = path.join(h, 'tmp', 'kullanim.txt');
  fs.writeFileSync(kullanim, `${path.join(h, 'empp-serit/kabul-ev/ev-1/a.bin')}\n${path.join(h, 'DijiTap/DijiTap/Kitap/app.bin')}\n`);
  const r = kostur(h, ['--ek', path.join(h, 'DijiTap'), ...ULASILMAZ], { DT_KULLANIMDA: kullanim });
  assert.ok(var_(h, 'empp-serit/kabul-ev/ev-1/a.bin'));
  assert.ok(var_(h, 'DijiTap/DijiTap/Kitap/app.bin'), 'açık uygulama varken DijiTap silinmez');
  assert.match(r.stdout, /ATLANDI .*DijiTap \(kullanimda/);
});

test('İLK TEMİZLİK: --ek ~/testler ~/Silinecekler ~/DijiTap bütünüyle silinir (Nadir açıkça sildirdi)', () => {
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
  assert.ok(var_(h, 'testler/taze/yeni.bin'), 'taze test dizini silinmemeli');
  assert.match(r.stdout, /ATLANDI .*testler\/taze \(son 120 dk/);
  assert.ok(!var_(h, 'kabuk-aday-test'), 'kullanıcının açık yolu (~ ile) silinmeli');
  assert.match(r.log, /kabuk-aday-test · \d+ MB · kullanici acikca verdi \(--ek\)/);
});

test('KORUMA: kabul kanıtı son 7 gün SİLİNMEZ; daha eskisi K2 adayıdır', () => {
  const h = sahteEv();
  dosya(h, '.empp-agent/kabul-kanit/yeni-3gun/k.json', { gun: 3, aday: '.empp-agent/kabul-kanit/yeni-3gun' });
  dosya(h, '.empp-agent/kabul-kanit/eski-9gun/k.json', { gun: 9, aday: '.empp-agent/kabul-kanit/eski-9gun' });
  const r = kostur(h, ULASILMAZ);
  assert.ok(var_(h, '.empp-agent/kabul-kanit/yeni-3gun/k.json'));
  assert.ok(!var_(h, '.empp-agent/kabul-kanit/eski-9gun'), r.stdout);
});

test('kabuk-aday klasörü ve İndirilenler paketleri aday; İndirilenler\'deki belge aday DEĞİL', () => {
  const h = sahteEv();
  dosya(h, 'kabuk-aday-test/1.13.14/a.bin', { aday: 'kabuk-aday-test' });
  dosya(h, 'İndirilenler/Cambridge One.yds', { gun: 3 });
  dosya(h, 'İndirilenler/fatura.pdf', { gun: 300 });
  const r = kostur(h, ULASILMAZ);
  assert.ok(!var_(h, 'kabuk-aday-test'), r.stdout);
  assert.ok(!var_(h, 'İndirilenler/Cambridge One.yds'));
  assert.ok(var_(h, 'İndirilenler/fatura.pdf'), 'bizim üretmediğimiz dosya silinmez');
});

test('hedef zaten sağlanmışsa aday taranmaz (yalnız --ek işlenir)', () => {
  const h = sahteEv();
  dosya(h, 'testler/eski.bin', { gun: 50 });
  dosya(h, 'Silinecekler/acik-istek.bin', { gun: 1 });
  const r = kostur(h, ['--ek', path.join(h, 'Silinecekler/acik-istek.bin')], { DT_DF: '100000000 99000000' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(var_(h, 'testler/eski.bin'));
  assert.ok(!var_(h, 'Silinecekler/acik-istek.bin'));
});

test('kaynak arşivi SON ÇARE: K1 hedefi karşılıyorsa arşive dokunulmaz', () => {
  const h = sahteEv();
  dosya(h, '.empp-agent/kaynak-arsivi/9/build.zip', { kb: 600, gun: 90, aday: '.empp-agent/kaynak-arsivi/9' });
  dosya(h, 'testler/t.bin', { kb: 1200, gun: 1 });
  const r = kostur(h, ['--hedef-gb', '0', '--hedef-yuzde', '1'], { DT_DF: '100000 0' });
  assert.equal(r.status, 0, r.stdout);
  assert.ok(var_(h, '.empp-agent/kaynak-arsivi/9/build.zip'), 'arşiv daha eski olsa da K1 önce');
  assert.ok(!var_(h, 'testler/t.bin'));
});

test('kilit: canlı bir koşu varken ikinci koşu 4 ile çıkar', () => {
  const h = sahteEv();
  const k = path.join(h, 'empp-serit/log/.disk-temizlik.kilit.d');
  fs.mkdirSync(k, { recursive: true });
  fs.writeFileSync(path.join(k, 'pid'), String(process.pid));
  const r = kostur(h, ULASILMAZ);
  assert.equal(r.status, 4);
});

test('kur.sh disk kapısı önce temizliği koşturur, sonra yeniden ölçer; zamanlayıcıyı kurar', () => {
  const KUR = fs.readFileSync(path.join(__dirname, 'kur.sh'), 'utf8');
  const g = KUR.slice(KUR.indexOf('probook_kur(){'), KUR.indexOf('# Node 22 x64'));
  const iTemiz = g.indexOf('bash "$DT"');
  const iDur = g.indexOf('die "disk kapisi: ${BOS} GB bos < 30 GB"');
  assert.ok(iTemiz > 0 && iTemiz < iDur, 'temizlik dur kararından ÖNCE');
  assert.ok(g.lastIndexOf('BOS=$(df', iDur) > iTemiz, 'temizlikten sonra yeniden ölçülür');
  assert.match(KUR, /disk-temizlik\.sh" --zamanlayici-kur/);
  const ORTAM = fs.readFileSync(path.join(__dirname, 'serit-ortam.sh'), 'utf8');
  assert.match(ORTAM, /export EMPP_DISK_TEMIZLIK="\$\{EMPP_DISK_TEMIZLIK:-1\}"/);
});
