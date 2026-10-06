'use strict';
// windows-kasa disk temizlik bekçisi — sahte kökler (EMPP_AJAN_KOK, KABUL_KOK, EMPP_WIN_HAZIR_KOK,
// LOCALAPPDATA, DT_DIJITAP) altında `calistir` GERÇEKTEN siler; boş alan `bosOlcer` ile tohumlanır.
// Nadir 06.10: disk dolu → işi durdurma, yer aç; koruma listesi ASLA silinmez.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const D = require('./disk-temizlik');

const GUN = 86400000;
const kokler = [];
test.after(() => { for (const k of kokler) fs.rmSync(k, { recursive: true, force: true }); });

function kasa() {
  const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dt-kasa-')));
  kokler.push(r);
  const home = path.join(r, 'Users', 'Administrator');
  const env = {
    EMPP_AJAN_KOK: path.join(r, 'empp-ajan'),
    KABUL_KOK: path.join(r, 'kabul'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    DT_DIJITAP: path.join(r, 'DijiTap'),
    EMPP_KAYNAK_ARSIVI: path.join(r, 'empp-ajan', 'veri', 'kaynak-arsivi'),
    EMPP_SOURCE_CACHE: path.join(r, 'empp-ajan', 'veri', 'cache'),
  };
  const cfg = D.yapilandirma(env, home);
  cfg.silinecekler = [path.join(r, 'Silinecekler'), path.join(r, 'empp-ajan', 'Silinecekler')];
  return { r, home, cfg };
}
function yasla(p, gun) {
  const t = new Date(Date.now() - gun * GUN);
  const st = fs.lstatSync(p);
  if (st.isDirectory()) for (const a of fs.readdirSync(p)) yasla(path.join(p, a), gun);
  fs.utimesSync(p, t, t);
}
/** `dosyaYolu` yazar; `aday` (yoksa dosyanın kendisi) `gun` gün yaşlandırılır. */
function yaz(dosyaYolu, { kb = 4, gun = 10, aday = null } = {}) {
  fs.mkdirSync(path.dirname(dosyaYolu), { recursive: true });
  fs.writeFileSync(dosyaYolu, Buffer.alloc(kb * 1024, 1));
  yasla(aday || dosyaYolu, gun);
  return dosyaYolu;
}
function kos(cfg, o = {}) {
  const satirlar = [];
  let bos = o.bos === undefined ? 0 : o.bos;
  const r = D.calistir({ cfg, yaz: (s) => satirlar.push(s), surecler: [], bosOlcer: () => bos, ...o });
  return { ...r, cikti: satirlar.join('\n'), log: fs.readFileSync(cfg.log, 'utf8'), bosAyarla: (b) => { bos = b; } };
}
const var_ = (p) => fs.existsSync(p);

test('KURU: hiçbir şey silinmez; K1 (tmp, eski yedek) → K2 (hazır arşivi) → K3 (kaynak arşivi), katman içinde en eski önce', () => {
  const { cfg } = kasa();
  const a = yaz(path.join(cfg.tmp, 'empp-kapi-ESKI', 'x.bin'), { gun: 3, aday: path.join(cfg.tmp, 'empp-kapi-ESKI') });
  const b = yaz(path.join(cfg.tmp, 'empp-kapi-YENI', 'x.bin'), { gun: 1, aday: path.join(cfg.tmp, 'empp-kapi-YENI') });
  const ar = yaz(path.join(cfg.kaynakArsivi, '111', 'build.zip'), { gun: 30, aday: path.join(cfg.kaynakArsivi, '111') });
  for (let i = 0; i < 12; i++) {
    const d = path.join(cfg.hazir, 'yayinlandi', `1-2.0.${i}-x`);
    yaz(path.join(d, 'a.exe'), { gun: 20 - i, aday: d });
  }
  const r = kos(cfg, { kuru: true, bos: 0 });
  const sira = r.cikti.split('\n').filter((s) => s.startsWith('KURU ')).map((s) => s.split(' ')[3]);
  assert.deepEqual(sira, [path.dirname(a), path.dirname(b),
    path.join(cfg.hazir, 'yayinlandi', '1-2.0.0-x'), path.join(cfg.hazir, 'yayinlandi', '1-2.0.1-x'), path.dirname(ar)],
  'yayinlandi: 12 kayıttan en eski 2\'si aday, en yeni 10 kalır');
  for (const p of [a, b, ar]) assert.ok(var_(p));
  assert.match(r.log, / · KURU: gecici dizin/);
  assert.equal(r.durum, 'dar');
});

test('GERÇEK: en eskiden başlar, hedefe ulaşınca DURUR; günlük tarih · yol · boyut · neden', () => {
  const { cfg } = kasa();
  cfg.hedefGb = 0.0015; // 1,5 MB
  const eski = yaz(path.join(cfg.tmp, 'empp-kapi-A', 'x.bin'), { kb: 1000, gun: 5, aday: path.join(cfg.tmp, 'empp-kapi-A') });
  const orta = yaz(path.join(cfg.tmp, 'empp-kapi-B', 'x.bin'), { kb: 1000, gun: 4, aday: path.join(cfg.tmp, 'empp-kapi-B') });
  const yeni = yaz(path.join(cfg.tmp, 'empp-kapi-C', 'x.bin'), { kb: 1000, gun: 3, aday: path.join(cfg.tmp, 'empp-kapi-C') });
  // Gerçek ölçüm taklidi: boş alan = 3 MB − tmp'de kalan.
  const bosOlcer = () => 3072000 - D.agacOlc(cfg.tmp).boyut;
  D.calistir({ cfg, surecler: [], yaz: () => {}, bosOlcer });
  assert.ok(!var_(eski) && !var_(orta), 'iki en eski silinir');
  assert.ok(var_(yeni), 'hedefe ulaşınca durur');
  const log = fs.readFileSync(cfg.log, 'utf8');
  assert.match(log, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d · .*empp-kapi-A · \d+ MB · gecici dizin \(veri\\tmp\)$/m);
});

test('KORUMA: windows-hazir BEKLEYEN kayıtları (kabul-bekliyor/imza-bekliyor), imza-oncelik, jeton, ortam.ps1, aktivasyon kodu --ek ile bile silinmez', () => {
  const { cfg } = kasa();
  const bekleyen = yaz(path.join(cfg.hazir, '45549-2.50.12', 'manifest.json'), { gun: 30, aday: path.join(cfg.hazir, '45549-2.50.12') });
  const oncelik = yaz(path.join(cfg.ajan, 'imza-oncelik.txt'), { gun: 30 });
  const jeton = yaz(path.join(cfg.ajan, 'token.json'), { gun: 30 });
  const ortam = yaz(path.join(cfg.kok, 'ortam.ps1'), { gun: 30 });
  const akt = yaz(path.join(cfg.kok, 'kabul', 'aktivasyon-test-kodu.txt'), { gun: 30 });
  const r = kos(cfg, { ekler: [path.dirname(bekleyen), cfg.hazir, path.join(cfg.hazir, 'yayinlandi'), oncelik, jeton, ortam, akt, cfg.ajan, cfg.kok] });
  for (const p of [bekleyen, oncelik, jeton, ortam, akt]) assert.ok(var_(p), `korunan silindi: ${p}`);
  assert.equal(r.silinen.length, 0, r.cikti);
  assert.match(r.cikti, /45549-2\.50\.12 \(windows-hazir bekleyen kayit\/kok\)/);
});

test('KORUMA: çalışan sürecin komut satırı/exe yolu adayı içeriyorsa atlanır (--ek dahil)', () => {
  const { cfg } = kasa();
  const is = yaz(path.join(cfg.tmp, 'empp-agent-AKTIF', 'build.zip'), { gun: 1, aday: path.join(cfg.tmp, 'empp-agent-AKTIF') });
  const exe = yaz(path.join(cfg.kabulKok, '45449-imzasiz.exe'), { gun: 1 });
  const surecler = [`"c:\\node.exe" x ${path.dirname(is)}\\build.zip`.toLowerCase(), exe.toLowerCase()];
  const r = kos(cfg, { surecler, ekler: [exe] });
  assert.ok(var_(is) && var_(exe));
  assert.match(r.cikti, /empp-agent-AKTIF \(kullanimda/);
});

test('KORUMA: süreç listesi ölçülemezse (null) HİÇBİR şey silinmez', () => {
  const { cfg } = kasa();
  const p = yaz(path.join(cfg.tmp, 'empp-kapi-X', 'a.bin'), { gun: 9, aday: path.join(cfg.tmp, 'empp-kapi-X') });
  const r = kos(cfg, { surecler: null, ekler: [path.dirname(p)] });
  assert.ok(var_(p));
  assert.equal(r.olculemedi, true);
});

test('KORUMA: son 120 dk içinde değişen ağaç atlanır; kabul kanıtı 7 gün korunur', () => {
  const { cfg } = kasa();
  const taze = yaz(path.join(cfg.tmp, 'empp-agent-TAZE', 'a.bin'), { gun: 0, aday: path.join(cfg.tmp, 'empp-agent-TAZE') });
  const kanitYeni = yaz(path.join(cfg.ajan, 'kabul-kanit', 'k-3', 'a.json'), { gun: 3, aday: path.join(cfg.ajan, 'kabul-kanit', 'k-3') });
  const kanitEski = yaz(path.join(cfg.ajan, 'kabul-kanit', 'k-9', 'a.json'), { gun: 9, aday: path.join(cfg.ajan, 'kabul-kanit', 'k-9') });
  const r = kos(cfg);
  assert.ok(var_(taze), 'taze iş dizini silinmemeli');
  assert.match(r.cikti, /empp-agent-TAZE \(son 120 dk/);
  assert.ok(var_(kanitYeni));
  assert.ok(!var_(kanitEski));
});

test('yedek-paketleyici-* ve kasa-guncel-*.tar: en yeni 3 kalır', () => {
  const { cfg } = kasa();
  const y = [];
  for (let i = 0; i < 5; i++) {
    const d = path.join(cfg.kok, `yedek-paketleyici-2026100${i}`);
    yaz(path.join(d, 'a.txt'), { gun: 10 - i, aday: d });
    y.push(d);
    yaz(path.join(cfg.kok, `kasa-guncel-2026100${i}.tar`), { gun: 10 - i });
  }
  kos(cfg);
  assert.deepEqual(y.map(var_), [false, false, true, true, true]);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => var_(path.join(cfg.kok, `kasa-guncel-2026100${i}.tar`))), [false, false, true, true, true]);
});

test('Programs: kabulün kurduğu uygulama (app.asar / exe yok) aday; Ollama/Opera/Python ve asar\'sız exe\'li program DEĞİL', () => {
  const { cfg } = kasa();
  const bizim = yaz(path.join(cfg.programs, 'shall-we-8-set', 'resources', 'app.asar'), { gun: 2, aday: path.join(cfg.programs, 'shall-we-8-set') });
  const artik = yaz(path.join(cfg.programs, 'impact-grade-12', 'log.txt'), { gun: 2, aday: path.join(cfg.programs, 'impact-grade-12') });
  const ollama = yaz(path.join(cfg.programs, 'Ollama', 'resources', 'app.asar'), { gun: 200, aday: path.join(cfg.programs, 'Ollama') });
  const vscode = yaz(path.join(cfg.programs, 'Microsoft VS Code', 'Code.exe'), { gun: 200, aday: path.join(cfg.programs, 'Microsoft VS Code') });
  kos(cfg);
  assert.ok(!var_(bizim) && !var_(artik));
  assert.ok(var_(ollama) && var_(vscode), 'bizim üretmediğimiz program silinmez');
});

test('Downloads: yalnız paket uzantıları; belge DEĞİL. C:\\kabul profilleri/exe önbelleği aday', () => {
  const { cfg } = kasa();
  const pkt = yaz(path.join(cfg.downloads, 'Shall We 6 Set - Setup.exe'), { gun: 2 });
  const belge = yaz(path.join(cfg.downloads, 'sozlesme.pdf'), { gun: 300 });
  const prof = path.join(cfg.kabulKok, 'akt-profil-45448-imzali-1');
  yaz(path.join(prof, 'Prefs'), { gun: 1, aday: prof });
  kos(cfg);
  assert.ok(!var_(pkt) && !var_(prof));
  assert.ok(var_(belge));
});

test('kaynak arşivi SON ÇARE: K1 hedefi karşılıyorsa arşive dokunulmaz', () => {
  const { cfg } = kasa();
  cfg.hedefGb = 0.001;
  const ar = yaz(path.join(cfg.kaynakArsivi, '9', 'build.zip'), { kb: 2000, gun: 90, aday: path.join(cfg.kaynakArsivi, '9') });
  const t = yaz(path.join(cfg.tmp, 'empp-kapi-Z', 'a.bin'), { kb: 1500, gun: 1, aday: path.join(cfg.tmp, 'empp-kapi-Z') });
  const r = kos(cfg, { bosOlcer: () => 1536000 - D.agacOlc(cfg.tmp).boyut });
  assert.equal(r.silinen.length, 1, 'hedefe ulaşınca K3 aday olmaz');
  assert.ok(var_(ar) && !var_(t));
});

test('korunuyor: saf kararlar', () => {
  const { cfg } = kasa();
  assert.match(D.korunuyor('goreli/yol', cfg), /mutlak/);
  assert.match(D.korunuyor(path.join(cfg.kok, 'paketleyici', 'src'), cfg), /koruma/);
  assert.match(D.korunuyor(cfg.tmp, cfg), /koruma/);
  assert.match(D.korunuyor(path.join(cfg.hazir, 'yayinlandi'), cfg), /bekleyen kayit\/kok/);
  assert.equal(D.korunuyor(path.join(cfg.hazir, 'yayinlandi', '1-2.0.0-x'), cfg), null);
  assert.equal(D.korunuyor(path.join(cfg.tmp, 'empp-kapi-X'), cfg), null);
  assert.match(D.korunuyor(path.join(cfg.tmp, 'node-compile-cache'), cfg), /koruma/);
});

test('kilit: canlı sahipli kilit varken ikinci alma başarısız; sahibi ölüyse devralınır', () => {
  const { r } = kasa();
  const dizin = path.join(r, 'log');
  const birak = D.kilitAl(dizin);
  assert.ok(birak);
  assert.equal(D.kilitAl(dizin), null);
  birak();
  fs.mkdirSync(path.join(dizin, '.disk-temizlik.kilit'));
  fs.writeFileSync(path.join(dizin, '.disk-temizlik.kilit', 'pid'), '999999');
  const b2 = D.kilitAl(dizin);
  assert.ok(b2, 'ölü sahip → devral');
  b2();
});

test('CLI: win32 dışında (Mac/srv21) KOŞMAZ', { skip: process.platform === 'win32' }, () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'disk-temizlik.js'), '--kuru'], {
    encoding: 'utf8', env: { ...process.env, DT_TEST: '' },
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /yalnız windows-kasa/);
});

test('argümanlar: --kuru --ek --hedef-gb; bilinmeyen reddedilir', () => {
  assert.deepEqual(D.argumanlar(['--kuru', '--ek', 'C:\\x', '--hedef-gb', '40']), { kuru: true, ekler: ['C:\\x'], hedefGb: 40 });
  assert.throws(() => D.argumanlar(['--sil-hepsini']));
});

test('ince ps1 sarmalayıcı js\'i çağırır; görev saatlik ve gizli', () => {
  const ps1 = fs.readFileSync(path.join(__dirname, 'disk-temizlik.ps1'), 'utf8');
  assert.match(ps1, /tools\\windows\\kasa-ajan\\disk-temizlik\.js/);
  assert.match(ps1, /araclar\\node\\node\.exe/);
  const gorev = fs.readFileSync(path.join(__dirname, 'disk-temizlik-gorev-kur.ps1'), 'utf8');
  assert.match(gorev, /\$AralikDk = 60/);
  assert.match(gorev, /-WindowStyle Hidden/);
  assert.match(gorev, /TaskName 'empp-disk-temizlik'/);
  const ortam = fs.readFileSync(path.join(__dirname, 'ortam.ps1'), 'utf8');
  assert.match(ortam, /\$env:EMPP_DISK_TEMIZLIK = '1'/);
});

test('izlenen sayaç hedefi gösterse de GERÇEK ölçüm darsa silmeye devam eder (eşzamanlı üretim yazıyor)', () => {
  const { cfg } = kasa();
  cfg.hedefGb = 0.0015;
  const a = yaz(path.join(cfg.tmp, 'empp-kapi-A', 'x.bin'), { kb: 1000, gun: 5, aday: path.join(cfg.tmp, 'empp-kapi-A') });
  const b = yaz(path.join(cfg.tmp, 'empp-kapi-B', 'x.bin'), { kb: 1000, gun: 4, aday: path.join(cfg.tmp, 'empp-kapi-B') });
  const c = yaz(path.join(cfg.tmp, 'empp-kapi-C', 'x.bin'), { kb: 1000, gun: 3, aday: path.join(cfg.tmp, 'empp-kapi-C') });
  // Başka süreç her ölçüm arasında 300 KB yazıyor: sayaç iki silmede hedefi gösterir, gerçek ölçüm
  // 1,45 MB < 1,5 MB der → üçüncü de silinir.
  let olcum = 0;
  const r = kos(cfg, { bosOlcer: () => 3072000 - D.agacOlc(cfg.tmp).boyut - (++olcum) * 300000 });
  assert.ok(!var_(a) && !var_(b) && !var_(c), r.cikti);
  assert.equal(r.durum, 'tamam');
});
