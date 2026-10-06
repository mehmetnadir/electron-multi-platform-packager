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
test.after(() => {
  for (const k of kokler) { spawnSync('chmod', ['-R', 'u+rwx', k]); fs.rmSync(k, { recursive: true, force: true }); }
});

/** Sahte kasa. `junction`: ~\.empp-agent sembolik bağ → <kok>\ev (kasadaki junction'ın eşi). */
function kasa({ junction = false, izin = true, env: ekEnv = {} } = {}) {
  const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dt-kasa-')));
  kokler.push(r);
  const home = path.join(r, 'Users', 'Administrator');
  const K = path.join(r, 'empp-ajan');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(K, { recursive: true });
  if (izin) fs.writeFileSync(path.join(K, 'disk-temizlik.izin'), 'test\n');
  if (junction) {
    fs.mkdirSync(path.join(K, 'ev'), { recursive: true });
    fs.symlinkSync(path.join(K, 'ev'), path.join(home, '.empp-agent'));
  }
  const env = {
    EMPP_AJAN_KOK: K,
    KABUL_KOK: path.join(r, 'kabul'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    DT_DIJITAP: path.join(r, 'DijiTap'),
    EMPP_KAYNAK_ARSIVI: path.join(K, 'veri', 'kaynak-arsivi'),
    EMPP_SOURCE_CACHE: path.join(K, 'veri', 'cache'),
    ...ekEnv,
  };
  const cfg = D.yapilandirma(env, home);
  cfg.silinecekler = [path.join(r, 'Silinecekler'), path.join(K, 'Silinecekler')];
  cfg.izinliKokler = [cfg.kok, cfg.kabulKok, cfg.dijitap, cfg.downloads, ...cfg.silinecekler, cfg.ajan, cfg.programs];
  return { r, home, cfg };
}
function yasla(p, gun) {
  const t = new Date(Date.now() - gun * GUN);
  const st = fs.lstatSync(p);
  if (st.isDirectory()) for (const a of fs.readdirSync(p)) yasla(path.join(p, a), gun);
  if (!st.isSymbolicLink()) fs.utimesSync(p, t, t);
}
function yaz(dosyaYolu, { kb = 4, gun = 10, aday = null } = {}) {
  fs.mkdirSync(path.dirname(dosyaYolu), { recursive: true });
  fs.writeFileSync(dosyaYolu, Buffer.alloc(kb * 1024, 1));
  yasla(aday || dosyaYolu, gun);
  return dosyaYolu;
}
function kos(cfg, o = {}) {
  const satirlar = [];
  const r = D.calistir({ cfg, yaz: (s) => satirlar.push(s), surecler: [], bosOlcer: () => 0, ...o });
  return { ...r, cikti: satirlar.join('\n'), log: fs.existsSync(cfg.log) ? fs.readFileSync(cfg.log, 'utf8') : '' };
}
const var_ = (p) => { try { fs.lstatSync(p); return true; } catch (_) { return false; } };

test('KURU: hiçbir şey silinmez; K1 → K2, katman içinde en eski önce; K3 sert eşik üstünde açılmaz', () => {
  const { cfg } = kasa();
  const a = yaz(path.join(cfg.tmp, 'empp-kapi-ESKI', 'x.bin'), { gun: 3, aday: path.join(cfg.tmp, 'empp-kapi-ESKI') });
  const b = yaz(path.join(cfg.tmp, 'empp-kapi-YENI', 'x.bin'), { gun: 1, aday: path.join(cfg.tmp, 'empp-kapi-YENI') });
  const ar = yaz(path.join(cfg.kaynakArsivi, '111', 'build.zip'), { gun: 30, aday: path.join(cfg.kaynakArsivi, '111') });
  for (let i = 0; i < 12; i++) {
    const d = path.join(cfg.hazir, 'yayinlandi', `1-2.0.${i}-x`);
    yaz(path.join(d, 'a.exe'), { gun: 20 - i, aday: d });
  }
  const r = kos(cfg, { kuru: true, bosOlcer: () => 20 * 1024 ** 3 }); // 20 GB > sert 15
  const sira = r.cikti.split('\n').filter((s) => s.startsWith('KURU ')).map((s) => s.split(' ')[3]);
  assert.deepEqual(sira, [path.dirname(a), path.dirname(b),
    path.join(cfg.hazir, 'yayinlandi', '1-2.0.0-x'), path.join(cfg.hazir, 'yayinlandi', '1-2.0.1-x')]);
  for (const p of [a, b, ar]) assert.ok(var_(p));
  assert.equal(r.durum, 'dar');
});

test('K3: yalnız sert eşik altında açılır, sert eşiğe ulaşınca durur', () => {
  const { cfg } = kasa();
  cfg.hedefGb = 40; cfg.sertGb = 0.002; // sert ≈ 2,1 MB
  const a1 = yaz(path.join(cfg.kaynakArsivi, '1', 'build.zip'), { kb: 1500, gun: 30, aday: path.join(cfg.kaynakArsivi, '1') });
  const a2 = yaz(path.join(cfg.kaynakArsivi, '2', 'build.zip'), { kb: 1500, gun: 20, aday: path.join(cfg.kaynakArsivi, '2') });
  // boş 1 MB < sert; ilk arşiv (1,5 MB) silinince 2,5 MB ≥ sert.
  kos(cfg, { bosOlcer: () => 1000000 + (3072000 - D.agacOlc(cfg.kaynakArsivi).boyut) });
  assert.ok(!var_(a1), 'en eski arşiv silinir');
  assert.ok(var_(a2), 'sert eşiğe ulaşınca durur');
});

test('GERÇEK: en eskiden başlar, hedefe ulaşınca DURUR; günlük tarih · yol · boyut · neden', () => {
  const { cfg } = kasa();
  cfg.hedefGb = 0.0015;
  const eski = yaz(path.join(cfg.tmp, 'empp-kapi-A', 'x.bin'), { kb: 1000, gun: 5, aday: path.join(cfg.tmp, 'empp-kapi-A') });
  const orta = yaz(path.join(cfg.tmp, 'empp-kapi-B', 'x.bin'), { kb: 1000, gun: 4, aday: path.join(cfg.tmp, 'empp-kapi-B') });
  const yeni = yaz(path.join(cfg.tmp, 'empp-kapi-C', 'x.bin'), { kb: 1000, gun: 3, aday: path.join(cfg.tmp, 'empp-kapi-C') });
  const r = kos(cfg, { bosOlcer: () => 3072000 - D.agacOlc(cfg.tmp).boyut });
  assert.ok(!var_(eski) && !var_(orta));
  assert.ok(var_(yeni), 'hedefe ulaşınca durur');
  assert.match(r.log, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d · .*empp-kapi-A · \d+ MB · gecici dizin \(veri\\tmp\)$/m);
});

test('izlenen sayaç hedefi gösterse de GERÇEK ölçüm darsa silmeye devam eder', () => {
  const { cfg } = kasa();
  cfg.hedefGb = 0.0015;
  const ps = ['A', 'B', 'C'].map((x, i) => yaz(path.join(cfg.tmp, `empp-kapi-${x}`, 'x.bin'), { kb: 1000, gun: 5 - i, aday: path.join(cfg.tmp, `empp-kapi-${x}`) }));
  let n = 0;
  const r = kos(cfg, { bosOlcer: () => 3072000 - D.agacOlc(cfg.tmp).boyut - (++n) * 300000 });
  assert.ok(ps.every((p) => !var_(p)), r.cikti);
  assert.equal(r.durum, 'tamam');
});

test('--hedef-gb varsayılan rahatlık hedefinin YERİNE geçer (ProBook ile aynı)', () => {
  const { cfg } = kasa();
  assert.equal(cfg.hedefGb, 40);
  assert.equal(D.cfgUygula(cfg, { hedefGb: 15, sertGb: null }).hedefGb, 15);
  assert.equal(D.cfgUygula(cfg, { hedefGb: 60, sertGb: 20 }).sertGb, 20);
});

// ---------------------------------------------------------------- koruma
test('KORUMA TABLOSU: bekleyen hazır kaydı, imza-oncelik, jeton, ortam.ps1, aktivasyon kodu, izin dosyası — düz/..//bağ biçimiyle --ek verilse de SİLİNMEZ', () => {
  const { cfg, home } = kasa({ junction: true });
  const korunan = [
    path.join(cfg.hazir, '45549-2.50.12', 'manifest.json'), path.join(cfg.ajan, 'imza-oncelik.txt'),
    path.join(cfg.ajan, 'token.json'), path.join(cfg.kok, 'ortam.ps1'), path.join(cfg.kok, 'kabul', 'aktivasyon-test-kodu.txt'),
    path.join(cfg.kok, 'paketleyici', 'src', 'x.js'), path.join(cfg.ajan, 'kabuk', 'k.js'),
  ];
  for (const p of korunan) yaz(p, { gun: 30 });
  const gercekAjan = fs.realpathSync(cfg.ajan);
  const ekler = [];
  for (const p of korunan) {
    ekler.push(p, path.dirname(p), path.join(path.dirname(p), '..', path.basename(path.dirname(p)), path.basename(p)));
    if (p.startsWith(cfg.ajan)) ekler.push(gercekAjan + p.slice(cfg.ajan.length)); // junction'ın gerçek biçimi
  }
  ekler.push(cfg.hazir, path.join(cfg.hazir, 'yayinlandi'), cfg.ajan, gercekAjan, cfg.kok, path.join(home, '.empp-agent', '.'),
    path.join(cfg.kok, 'disk-temizlik.izin'));
  const r = kos(cfg, { ekler });
  for (const p of korunan) assert.ok(var_(p), `korunan silindi: ${p}\n${r.cikti}`);
  assert.ok(var_(path.join(cfg.kok, 'disk-temizlik.izin')));
  assert.equal(r.silinen.length, 0, r.cikti);
});

test('JUNCTION: ajan dizini bağ olsa da korunan dosya gerçek yolundan (<kok>\\ev) verilince SİLİNMEZ; kullanım iki biçimle eşleşir', () => {
  const { cfg } = kasa({ junction: true });
  const tok = yaz(path.join(cfg.ajan, 'token.json'), { gun: 30 });
  const gercek = path.join(cfg.kok, 'ev', 'token.json');
  assert.ok(fs.existsSync(gercek));
  assert.match(D.korunuyor(gercek, cfg), /koruma/);
  const icerik = yaz(path.join(cfg.kok, 'ev', 'icerik-onbellek', '7', '7-1.zip'), { gun: 9, aday: path.join(cfg.kok, 'ev', 'icerik-onbellek', '7') });
  const r = kos(cfg, { surecler: [`node x ${path.join(cfg.ajan, 'icerik-onbellek', '7')}\\7-1.zip`.toLowerCase()] });
  assert.ok(var_(tok) && var_(icerik), r.cikti);
  assert.match(r.cikti, /icerik-onbellek.7 \(kullanimda/);
});

test('İZİNLİ KÖK: env yanlışsa (EMPP_SOURCE_CACHE kök dışı) kök dışı aday reddedilir; --ek de izinli kök dışında silinmez', () => {
  const disari = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dt-disari-')));
  kokler.push(disari);
  const { cfg } = kasa({ env: { EMPP_SOURCE_CACHE: disari } });
  const p = yaz(path.join(disari, 'onemli', 'belge.txt'), { gun: 90, aday: path.join(disari, 'onemli') });
  const r = kos(cfg, { ekler: [path.join(disari, 'onemli'), os.homedir()] });
  assert.ok(var_(p), r.cikti);
  assert.match(r.cikti, /onemli \(izinli kok disinda/);
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

test('KORUMA: izin dosyası yoksa (izinsiz makine) HİÇBİR şey silinmez', () => {
  const { cfg } = kasa({ izin: false });
  const p = yaz(path.join(cfg.tmp, 'empp-kapi-X', 'a.bin'), { gun: 9, aday: path.join(cfg.tmp, 'empp-kapi-X') });
  const r = kos(cfg, { ekler: [path.dirname(p)] });
  assert.ok(var_(p));
  assert.equal(r.izinYok, true);
});

test('KORUMA: sahibi canlı runner iş dizini (.empp-sahip.pid) atlanır; sahibi ölü olan silinir', () => {
  const { cfg } = kasa();
  const c = path.join(cfg.tmp, 'empp-agent-CANLI');
  const o = path.join(cfg.tmp, 'empp-agent-OLU');
  yaz(path.join(c, 'build.zip'), { gun: 9 });
  fs.writeFileSync(path.join(c, '.empp-sahip.pid'), String(process.pid));
  yasla(c, 9);
  yaz(path.join(o, 'build.zip'), { gun: 9 });
  fs.writeFileSync(path.join(o, '.empp-sahip.pid'), '999999');
  yasla(o, 9);
  const r = kos(cfg);
  assert.ok(var_(c), r.cikti);
  assert.match(r.cikti, /empp-agent-CANLI \(sahibi canli/);
  assert.ok(!var_(o));
});

test('KORUMA: son 120 dk içinde değişen ağaç atlanır; kabul kanıtı 7 gün korunur', () => {
  const { cfg } = kasa();
  const taze = yaz(path.join(cfg.tmp, 'empp-agent-TAZE', 'a.bin'), { gun: 0, aday: path.join(cfg.tmp, 'empp-agent-TAZE') });
  const kanitYeni = yaz(path.join(cfg.ajan, 'kabul-kanit', 'k-3', 'a.json'), { gun: 3, aday: path.join(cfg.ajan, 'kabul-kanit', 'k-3') });
  const kanitEski = yaz(path.join(cfg.ajan, 'kabul-kanit', 'k-9', 'a.json'), { gun: 9, aday: path.join(cfg.ajan, 'kabul-kanit', 'k-9') });
  const r = kos(cfg);
  assert.ok(var_(taze));
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

test('PROGRAMS İZİN LİSTESİ: yalnız bizim paket.json manifestli; boş kalıntı ve yabancı Electron uygulaması ASLA', () => {
  const { cfg } = kasa();
  const P = cfg.programs;
  const bizim = path.join(P, 'shall-we-8-set');
  yaz(path.join(bizim, 'resources', 'app', 'paket.json'), { gun: 5 });
  fs.writeFileSync(path.join(bizim, 'resources', 'app', 'paket.json'), JSON.stringify({ setId: 'sw8-abc', setIdKaynagi: 'verildi' }));
  yaz(path.join(bizim, 'Shall We 8.exe'), { gun: 5 });
  yasla(bizim, 5);
  const kalinti = path.join(P, 'impact-grade-12');
  fs.mkdirSync(path.join(kalinti, 'locales'), { recursive: true });
  yasla(kalinti, 2);
  const yabanciAsar = path.join(P, 'slack');
  yaz(path.join(yabanciAsar, 'resources', 'app.asar'), { gun: 300 });
  yaz(path.join(yabanciAsar, 'slack.exe'), { gun: 300, aday: yabanciAsar });
  const yabanciApp = path.join(P, 'baska-electron');
  yaz(path.join(yabanciApp, 'resources', 'app', 'package.json'), { gun: 300, aday: yabanciApp });
  const sahte = path.join(P, 'sahte-paket');
  yaz(path.join(sahte, 'resources', 'app', 'paket.json'), { gun: 300 });
  fs.writeFileSync(path.join(sahte, 'resources', 'app', 'paket.json'), JSON.stringify({ ad: 'baska' }));
  yasla(sahte, 300);
  const ollama = path.join(P, 'Ollama');
  yaz(path.join(ollama, 'ollama.exe'), { gun: 200, aday: ollama });
  const r = kos(cfg);
  assert.ok(!var_(bizim), r.cikti);
  const common = path.join(P, 'Common');
  fs.mkdirSync(common);
  yasla(common, 300);
  kos(cfg);
  for (const p of [kalinti, common, yabanciAsar, yabanciApp, sahte, ollama]) assert.ok(var_(p), `yabancı uygulama silindi: ${p}`);
});

test('DijiTap: yalnız ZKitap kurulumları aday; tanınmayan dizin DEĞİL', () => {
  const { cfg } = kasa();
  const z = path.join(cfg.dijitap, 'akillitahta.ydspublishing.com', 'ShallWe8-v47');
  yaz(path.join(z, 'resources', 'app', 'package.json'), { gun: 5 });
  fs.writeFileSync(path.join(z, 'resources', 'app', 'package.json'), JSON.stringify({ name: 'zkitap' }));
  yasla(z, 5);
  const baska = path.join(cfg.dijitap, 'alan', 'baska-uygulama');
  yaz(path.join(baska, 'app.exe'), { gun: 90, aday: baska });
  kos(cfg);
  assert.ok(!var_(z));
  assert.ok(var_(baska));
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
  assert.equal(r.silinen.length, 1);
  assert.ok(var_(ar) && !var_(t));
});

test('--koru: çalışan işin arşivi sert eşik altında da silinmez', () => {
  const { cfg } = kasa();
  const a9 = yaz(path.join(cfg.kaynakArsivi, '9', 'build.zip'), { gun: 90, aday: path.join(cfg.kaynakArsivi, '9') });
  const a8 = yaz(path.join(cfg.kaynakArsivi, '8', 'build.zip'), { gun: 30, aday: path.join(cfg.kaynakArsivi, '8') });
  const r = kos(cfg, { koru: [path.dirname(a9)] });
  assert.ok(var_(a9), r.cikti);
  assert.ok(!var_(a8));
});

// ---------------------------------------------------------------- disk tam dolu
test('DİSK DOLU: günlük yazılamazsa satır stdout\'a düşer, silme sürer', () => {
  const { cfg } = kasa();
  const p = yaz(path.join(cfg.tmp, 'empp-kapi-X', 'a.bin'), { gun: 9, aday: path.join(cfg.tmp, 'empp-kapi-X') });
  fs.mkdirSync(path.dirname(cfg.log), { recursive: true });
  fs.writeFileSync(cfg.log, '');
  fs.chmodSync(cfg.log, 0o444);
  const r = kos(cfg);
  assert.ok(!var_(p), r.cikti);
  assert.match(r.cikti, /^GUNLUK-YAZILAMADI .*empp-kapi-X/m);
});

test('kilit: dosya oluşturmayan boru kilidi — ikinci alma başarısız, bırakınca yeniden alınır', async () => {
  const ad = process.platform === 'win32' ? `\\\\.\\pipe\\dt-test-${process.pid}` : path.join(os.tmpdir(), `dt-kilit-${process.pid}.sock`);
  const b1 = await D.kilitAl(ad);
  assert.ok(b1);
  assert.equal(await D.kilitAl(ad), null);
  b1();
  await new Promise((r) => setTimeout(r, 50));
  const b2 = await D.kilitAl(ad);
  assert.ok(b2);
  b2();
});

test('CLI: win32 dışında (Mac/srv21) HER DURUMDA koşmaz — test anahtarı yok', { skip: process.platform === 'win32' }, () => {
  for (const env of [{}, { DT_TEST: '1' }]) {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'disk-temizlik.js'), '--kuru'], {
      encoding: 'utf8', env: { ...process.env, ...env },
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /yalnız windows-kasa/);
  }
});

test('argümanlar: --kuru --ek --koru --hedef-gb --sert-gb; bilinmeyen reddedilir', () => {
  assert.deepEqual(D.argumanlar(['--kuru', '--ek', 'C:\\x', '--koru', 'C:\\y', '--hedef-gb', '40', '--sert-gb', '15']),
    { kuru: true, ekler: ['C:\\x'], koru: ['C:\\y'], hedefGb: 40, sertGb: 15 });
  assert.throws(() => D.argumanlar(['--sil-hepsini']));
});

test('ince ps1 sarmalayıcı js\'i çağırır; görev saatlik, gizli ve izin dosyasını yazar', () => {
  const ps1 = fs.readFileSync(path.join(__dirname, 'disk-temizlik.ps1'), 'utf8');
  assert.match(ps1, /tools\\windows\\kasa-ajan\\disk-temizlik\.js/);
  assert.match(ps1, /araclar\\node\\node\.exe/);
  const gorev = fs.readFileSync(path.join(__dirname, 'disk-temizlik-gorev-kur.ps1'), 'utf8');
  assert.match(gorev, /\$AralikDk = 60/);
  assert.match(gorev, /-WindowStyle Hidden/);
  assert.match(gorev, /TaskName 'empp-disk-temizlik'/);
  assert.match(gorev, /disk-temizlik\.izin/);
  const ortam = fs.readFileSync(path.join(__dirname, 'ortam.ps1'), 'utf8');
  assert.match(ortam, /\$env:EMPP_DISK_TEMIZLIK = '1'/);
});

// ---------------------------------------------------------------- 2. inceleme (K2, K3, Ö-B)
test('K2: CLI ortamı DT_* test anahtarlarını süzer; yapılandırmaya girmez', () => {
  const env = D.cliOrtami({ DT_HEDEF_GB: '1', DT_KORU_DK: '0', dt_dijitap: 'C:\\', EMPP_AJAN_KOK: 'C:\\empp-ajan', PATH: 'x' });
  assert.deepEqual(Object.keys(env).sort(), ['EMPP_AJAN_KOK', 'PATH']);
  const cfg = D.yapilandirma(D.cliOrtami({ DT_HEDEF_GB: '1', DT_KORU_DK: '0' }), 'C:\\Users\\A');
  assert.equal(cfg.hedefGb, 40);
  assert.equal(cfg.koruDk, 120);
  assert.match(fs.readFileSync(path.join(__dirname, 'disk-temizlik.js'), 'utf8'), /yapilandirma\(cliOrtami\(process\.env\)\)/);
});

test('K3: boş .empp-sahip.pid "yok" sayılır — dizin silinir', () => {
  const { cfg } = kasa();
  const d = path.join(cfg.tmp, 'empp-agent-BOS');
  yaz(path.join(d, 'build.zip'), { gun: 9 });
  fs.writeFileSync(path.join(d, '.empp-sahip.pid'), '');
  yasla(d, 9);
  assert.equal(D.sahibiCanli(d), false);
  kos(cfg);
  assert.ok(!var_(d));
});

test('Ö-B: süreç listesi ölçülemezse SONUC tarama=bozuk; normal koşuda tarama=tamam', () => {
  const { cfg } = kasa();
  assert.match(kos(cfg, { surecler: null }).cikti, /^SONUC .* hedef=dar tarama=bozuk$/m);
  assert.match(kos(cfg).cikti, /^SONUC .* tarama=tamam$/m);
});

test('İMZALI ARŞİV (Nadir 06.10): D:\\empp-imzali-son izinli kök DEĞİL, koruma ağacında; Downloads altına yanlış kurulsa da exe/son.json SİLİNMEZ', () => {
  const v = D.yapilandirma({}, '/h');
  assert.equal(v.imzaliArsiv, 'D:\\empp-imzali-son');
  assert.ok(v.koruAgac.includes('D:\\empp-imzali-son'));
  assert.ok(!v.izinliKokler.some((k) => String(k).toLowerCase().startsWith('d:')), 'D: izinli köklere girmez');
  assert.equal(D.yapilandirma({ EMPP_IMZALI_ARSIV_KOKU: 'E:\\x' }, '/h').imzaliArsiv, 'E:\\x');

  // En kötü durum: arşiv kökü env ile izinli bir kökün (Downloads) altına düşmüş, dosyalar eski.
  const r0 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dt-ia-')));
  kokler.push(r0);
  const home = path.join(r0, 'Users', 'Administrator');
  const arsiv = path.join(home, 'Downloads', 'empp-imzali-son');
  const { cfg } = kasa({ env: { EMPP_IMZALI_ARSIV_KOKU: arsiv } });
  cfg.downloads = path.dirname(arsiv);
  cfg.izinliKokler.push(cfg.downloads);
  const exe = yaz(path.join(arsiv, 'K Seti.exe'), { gun: 60 });
  const son = yaz(path.join(arsiv, '45449', 'son.json'), { gun: 60 });
  const r = kos(cfg, { ekler: [exe, path.join(arsiv, '45449'), arsiv] });
  assert.ok(var_(exe) && var_(son), r.cikti);
  assert.match(r.cikti, /koruma/);
});
