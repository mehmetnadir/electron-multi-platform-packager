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

test('komutSec: linux → bash disk-temizlik.sh --hedef-gb (yukarı yuvarlar); repo kopyası yoksa araclar', () => {
  const k = DT.komutSec({ platform: 'linux', env: ACIK, hedefGb: 14.2, varMi: () => true });
  assert.equal(k.komut, 'bash');
  assert.match(k.arg[0], /tools\/probook\/disk-temizlik\.sh$/);
  assert.deepEqual(k.arg.slice(1), ['--hedef-gb', '15']);
  const yedek = DT.komutSec({ platform: 'linux', env: ACIK, home: '/home/x', varMi: (p) => p.startsWith('/home/x') });
  assert.equal(yedek.arg[0], path.join('/home/x', 'empp-serit', 'araclar', 'disk-temizlik.sh'));
  assert.match(DT.komutSec({ platform: 'linux', env: ACIK, varMi: () => false }).atla, /bulunamadi/);
});

test('komutSec: win32 → node disk-temizlik.js', () => {
  const k = DT.komutSec({ platform: 'win32', env: ACIK, hedefGb: 15, varMi: () => true, node: 'C:\\node.exe' });
  assert.equal(k.komut, 'C:\\node.exe');
  assert.match(k.arg[0], /kasa-ajan[\\/]disk-temizlik\.js$/);
  assert.deepEqual(k.arg.slice(1), ['--hedef-gb', '15']);
});

test('sonucCoz: son SONUC satırı', () => {
  assert.deepEqual(DT.sonucCoz('x\nSONUC bos_gb=52 bos_yuzde=23 silinen_mb=900 kalem=3 atlanan=1 hedef=dar\n'),
    { bos_gb: 52, bos_yuzde: 23, silinen_mb: 900, kalem: 3, atlanan: 1, hedef: 'dar' });
  assert.equal(DT.sonucCoz('SONUC yok'), null);
});

test('yerAc: koşturur, loglar; 15 dk içinde ikinci çağrı yeniden koşturmaz (zorla hariç); fırlatmaz', async () => {
  DT._sifirla();
  const cagri = [];
  const kostur = async (k, a) => { cagri.push([k, a]); return { kod: 0, cikti: 'SILINDI 5 MB /x (t)\nSONUC bos_gb=60 hedef=tamam\n', hata: '' }; };
  const loglar = [];
  const ortak = { platform: 'linux', env: ACIK, varMi: () => true, kostur, log: (s) => loglar.push(s) };
  const r = await DT.yerAc({ ...ortak, gerekliGb: 20, simdi: 1000 });
  assert.equal(r.calisti, true);
  assert.equal(r.sonuc.hedef, 'tamam');
  assert.match(loglar.join('\n'), /silinen kalem=1 bos=60 GB hedef=tamam/);
  const r2 = await DT.yerAc({ ...ortak, gerekliGb: 20, simdi: 1000 + 60000 });
  assert.equal(r2.tekrar, true);
  assert.equal(cagri.length, 1);
  await DT.yerAc({ ...ortak, gerekliGb: 20, simdi: 1000 + DT.BEKLEME_MS + 1 });
  assert.equal(cagri.length, 2);
  await DT.yerAc({ ...ortak, gerekliGb: 20, simdi: 1000 + DT.BEKLEME_MS + 2, zorla: true });
  assert.equal(cagri.length, 3);
  DT._sifirla();
  const hata = await DT.yerAc({ ...ortak, kostur: async () => { throw new Error('ENOENT bash'); } });
  assert.equal(hata.calisti, true);
  assert.equal(hata.kod, -1);
  DT._sifirla();
});

test('RUNNER pardus erken disk kapısı: temizlik ertelemeden (throw) ÖNCE, sonra yeniden ölçüm', () => {
  const g = SRC.slice(SRC.indexOf('ERKEN DİSK KAPISI'), SRC.indexOf('pardus disk kapısı geçildi'));
  const iTemiz = g.indexOf('await diskTemizlik.yerAc({ gerekliGb, log })');
  const iOlc = g.indexOf('bosGb = diskBosGb(os.tmpdir());', iTemiz);
  const iAt = g.indexOf('throw new Error(');
  assert.ok(iTemiz > 0, 'temizlik çağrısı yok');
  assert.ok(iTemiz < iOlc && iOlc < iAt, 'sıra: temizlik → yeniden ölç → (hâlâ darsa) ertele');
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
