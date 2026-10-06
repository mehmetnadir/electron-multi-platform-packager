'use strict';
// Disk kapısı → önce yer aç (Nadir 06.10). Yardımcı (platform seçimi, bayrak, bekleme) + runner
// entegrasyonu: kapı kapanmadan ÖNCE temizlik çağrılır, sonra yeniden ölçülür.

// TEST YALITIMI (bkz. test-yalitim.js) — runner require edilmeden ÖNCE.
const { izoleOrtam } = require('./test-yalitim');
const YALITIM = izoleOrtam();

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const DT = require('./disk-temizlik');
const RUNNER = require('./runner.js');
const { CONFIG } = RUNNER;

YALITIM.configUygula(CONFIG);
after(() => YALITIM.temizle());

const SRC = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
const ACIK = { EMPP_DISK_TEMIZLIK: '1' };

test('komutSec: Mac\'te ASLA koşmaz (bayrak açık olsa da)', () => {
  assert.match(DT.komutSec({ platform: 'darwin', env: ACIK, varMi: () => true }).atla, /mac/);
});

test('komutSec: bayrak yoksa linux\'ta da koşmaz (srv21 linux\'tur, orada silme YASAK)', () => {
  assert.match(DT.komutSec({ platform: 'linux', env: {}, varMi: () => true }).atla, /EMPP_DISK_TEMIZLIK/);
  assert.match(DT.komutSec({ platform: 'win32', env: { EMPP_DISK_TEMIZLIK: '0' }, varMi: () => true }).atla, /EMPP_DISK_TEMIZLIK/);
});

test('komutSec: linux → bash disk-temizlik.sh; yalnız gereken GB (yüzde 0), sert eşik aynı, --koru; repo kopyası yoksa araclar', () => {
  const k = DT.komutSec({ platform: 'linux', env: ACIK, hedefGb: 14.2, koru: ['/w/empp-agent-1', '/a/kaynak-arsivi/9'], varMi: () => true });
  assert.equal(k.komut, 'bash');
  assert.match(k.arg[0], /tools\/probook\/disk-temizlik\.sh$/);
  assert.deepEqual(k.arg.slice(1), ['--hedef-gb', '15', '--sert-gb', '15', '--hedef-yuzde', '0',
    '--koru', '/w/empp-agent-1', '--koru', '/a/kaynak-arsivi/9']);
  const yedek = DT.komutSec({ platform: 'linux', env: ACIK, home: '/home/x', varMi: (p) => p.startsWith('/home/x') });
  assert.equal(yedek.arg[0], path.join('/home/x', 'empp-serit', 'araclar', 'disk-temizlik.sh'));
  assert.match(DT.komutSec({ platform: 'linux', env: ACIK, varMi: () => false }).atla, /bulunamadi/);
});

test('komutSec: win32 → node disk-temizlik.js (aynı --hedef-gb/--sert-gb/--koru sözleşmesi)', () => {
  const k = DT.komutSec({ platform: 'win32', env: ACIK, hedefGb: 15, koru: ['C:\\w'], varMi: () => true, node: 'C:\\node.exe' });
  assert.equal(k.komut, 'C:\\node.exe');
  assert.match(k.arg[0], /kasa-ajan[\\/]disk-temizlik\.js$/);
  assert.deepEqual(k.arg.slice(1), ['--hedef-gb', '15', '--sert-gb', '15', '--koru', 'C:\\w']);
});

test('sonucCoz: son SONUC satırı', () => {
  assert.deepEqual(DT.sonucCoz('x\nSONUC bos_gb=52 bos_yuzde=23 silinen_mb=900 kalem=3 atlanan=1 hedef=dar\n'),
    { bos_gb: 52, bos_yuzde: 23, silinen_mb: 900, kalem: 3, atlanan: 1, hedef: 'dar' });
  assert.equal(DT.sonucCoz('SONUC yok'), null);
});

test('yerAc: koru betiğe geçer; YALNIZ "hâlâ dar" (rc 3) önbelleğe alınır; hata ve tamam alınmaz; fırlatmaz', async () => {
  DT._sifirla();
  const cagri = [];
  let cevap = { kod: 3, cikti: 'SILINDI 5 MB /x (t)\nSONUC bos_gb=6 hedef=dar\n', hata: '' };
  const kostur = async (k, a) => { cagri.push([k, a]); return cevap; };
  const loglar = [];
  const ortak = { platform: 'linux', env: ACIK, varMi: () => true, kostur, log: (s) => loglar.push(s) };
  const r = await DT.yerAc({ ...ortak, gerekliGb: 20, koru: ['/arsiv/9'], simdi: 1000 });
  assert.equal(r.calisti, true);
  assert.deepEqual(cagri[0][1].slice(-2), ['--koru', '/arsiv/9']);
  assert.match(loglar.join('\n'), /silinen kalem=1 bos=6 GB hedef=dar/);
  const r2 = await DT.yerAc({ ...ortak, gerekliGb: 20, simdi: 1000 + 60000 });
  assert.equal(r2.tekrar, true, 'dar sonucu 15 dk tekrar koşturulmaz');
  assert.equal(cagri.length, 1);
  await DT.yerAc({ ...ortak, gerekliGb: 20, simdi: 1000 + 60000, zorla: true });
  assert.equal(cagri.length, 2);
  DT._sifirla();
  cevap = { kod: 0, cikti: 'SONUC bos_gb=60 hedef=tamam\n', hata: '' };
  await DT.yerAc({ ...ortak, gerekliGb: 20, simdi: 5000 });
  await DT.yerAc({ ...ortak, gerekliGb: 20, simdi: 5001 });
  assert.equal(cagri.length, 4, 'tamam sonucu önbelleğe alınmaz');
  cevap = { kod: 1, cikti: 'beklenmeyen', hata: 'patladı' };
  await DT.yerAc({ ...ortak, gerekliGb: 20, simdi: 6000 });
  await DT.yerAc({ ...ortak, gerekliGb: 20, simdi: 6001 });
  assert.equal(cagri.length, 6, 'hata kodu önbelleğe alınmaz');
  const hata = await DT.yerAc({ ...ortak, kostur: async () => { throw new Error('ENOENT bash'); }, simdi: 7000 });
  assert.equal(hata.kod, -1);
  const sonra = await DT.yerAc({ ...ortak, simdi: 7001 });
  assert.notEqual(sonra.tekrar, true, 'fırlatan koşu önbelleğe alınmaz');
  DT._sifirla();
});

test('RUNNER pardus erken disk kapısı: temizlik çalışan işin arşivini ve iş dizinini --koru ile geçer; arşiv kaybolursa ertele', () => {
  const g = SRC.slice(SRC.indexOf('ERKEN DİSK KAPISI'), SRC.indexOf('pardus disk kapısı geçildi'));
  const iTemiz = g.indexOf('await diskTemizlik.yerAc({ gerekliGb, log, warn, koru: [work, ...(arsiv && arsiv.zip ? [path.dirname(arsiv.zip)] : [])] })');
  const iOlc = g.indexOf('bosGb = diskBosGb(os.tmpdir());', iTemiz);
  const iKayip = g.indexOf('if (arsiv && arsiv.zip && !fs.existsSync(arsiv.zip))', iTemiz);
  const iAt = g.indexOf('pardus disk kapısı —');
  assert.ok(iTemiz > 0, 'koru\'lu temizlik çağrısı yok');
  assert.ok(iTemiz < iOlc && iOlc < iAt, 'sıra: temizlik → yeniden ölç → (hâlâ darsa) ertele');
  assert.ok(iKayip > iTemiz, 'temizlik sonrası arşiv varlığı denetlenir');
  assert.match(g.slice(iKayip, iKayip + 300), /throw new Error\(`\$\{DISK_KAPISI_ISARETI\} disk temizliği sonrası kaynak arşivi yok/);
  const isDizini = SRC.slice(SRC.indexOf('  let work;\n  try { work = await isDiziniAc'));
  assert.ok(isDizini.length < SRC.length, 'iş dizini açılışı bulunamadı');
  assert.match(isDizini.slice(0, 600), /\.empp-sahip\.pid/);
});

test('RUNNER windows üretim kapısı: disk dar → kapı kapanmadan önce yerAc(minGb) çağrılır; temizlik yetmezse kapalı', async () => {
  const hazirKok = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dt-hazir-')), 'windows-hazir');
  const alanlar = ['winKabulKuyrugu', 'winHazirAcik', 'winHazirKoku', 'winKabulDerinlik', 'winUretMinBosGb'];
  const eski = Object.fromEntries(alanlar.map((k) => [k, CONFIG[k]]));
  const eskiYerAc = DT.yerAc;
  const cagri = [];
  DT.yerAc = async (o) => { cagri.push(o.gerekliGb); return { calisti: true, kod: 3, sonuc: { hedef: 'dar' } }; };
  try {
    Object.assign(CONFIG, { winKabulKuyrugu: true, winHazirAcik: true, winHazirKoku: hazirKok, winKabulDerinlik: 1, winUretMinBosGb: 1e9 });
    const k = await RUNNER.uretimKapisiDurumu();
    assert.deepEqual(cagri, [1e9], 'temizlik kapının eşiğiyle çağrıldı');
    assert.equal(k.acik, false);
    assert.match(k.sebep, /üretim diski dar/);
    CONFIG.winUretMinBosGb = 0;
    await RUNNER.uretimKapisiDurumu();
    assert.equal(cagri.length, 1, 'disk yeterliyse temizlik çağrılmaz');
  } finally {
    DT.yerAc = eskiYerAc;
    Object.assign(CONFIG, eski);
    fs.rmSync(path.dirname(hazirKok), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- 2. inceleme (Ö-A, Ö-B)
test('Ö-A isDiziniAc: ENOSPC → temizlik (taban GB) → bir kez daha; yine ENOSPC → ertelenebilir (failed yok); başka hata temizliksiz', async () => {
  const { ertelenebilirKaynakHatasi } = require('./runner-helpers');
  const enospc = () => Object.assign(new Error('ENOSPC: no space left on device, mkdtemp'), { code: 'ENOSPC' });
  const temizlikler = [];
  const temizlik = async (o) => { temizlikler.push(o.gerekliGb); return { calisti: true }; };
  let n = 0;
  const bir = await RUNNER.isDiziniAc('pardus', { mkdtemp: async (p) => { if (++n === 1) throw enospc(); return `${p}OK`; }, temizlik });
  assert.match(bir, /empp-agent-OK$/);
  assert.deepEqual(temizlikler, [Number(process.env.PARDUS_DISK_TABAN_GB) || 15]);
  const eskiMin = CONFIG.winUretMinBosGb;
  CONFIG.winUretMinBosGb = 22;
  try {
    await assert.rejects(RUNNER.isDiziniAc('windows', { mkdtemp: async () => { throw enospc(); }, temizlik }), (e) => {
      assert.equal(ertelenebilirKaynakHatasi(e), true, 'ertelenebilir sınıf → failed yazılmaz');
      assert.match(e.message, /iş dizini açılamadı \(ENOSPC\)/);
      return true;
    });
  } finally { CONFIG.winUretMinBosGb = eskiMin; }
  assert.deepEqual(temizlikler.slice(-1), [22], 'windows tabanı winUretMinBosGb');
  const once = temizlikler.length;
  await assert.rejects(RUNNER.isDiziniAc('pardus', { mkdtemp: async () => { throw Object.assign(new Error('x'), { code: 'EACCES' }); }, temizlik }),
    (e) => e.code === 'EACCES');
  assert.equal(temizlikler.length, once, 'ENOSPC dışı hatada temizlik yok');
});

test('Ö-A/K3 kaynak: processJob iş dizinini isDiziniAc ile açar, hata yolunda currentJob sıfırlanır; pid yazımı düşerse dosya kaldırılır', () => {
  const pj = SRC.slice(SRC.indexOf('async function processJob'));
  assert.match(pj.slice(0, 900), /try \{ work = await isDiziniAc\(packagerPlatform\); \} catch \(e\) \{ currentJob = null; throw e; \}/);
  assert.doesNotMatch(pj.slice(0, 900), /const work = await fsp\.mkdtemp/);
  assert.match(pj.slice(0, 1500), /fs\.rmSync\(sahipDosyasi, \{ force: true \}\)/);
});

test('Ö-B yerAc: SONUC tarama=bozuk → warn loglanır (sessiz 0 silme yok)', async () => {
  DT._sifirla();
  const uyarilar = [];
  await DT.yerAc({ platform: 'linux', env: ACIK, varMi: () => true, gerekliGb: 20, warn: (s) => uyarilar.push(s),
    kostur: async () => ({ kod: 3, cikti: 'SONUC bos_gb=3 hedef=dar tarama=bozuk\n', hata: '' }) });
  assert.match(uyarilar.join('\n'), /süreç taraması BOZUK/);
  DT._sifirla();
});
